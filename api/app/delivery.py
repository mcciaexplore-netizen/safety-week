"""Courier delivery for online orders (DTDC): the weight of an order, the charge for it, and the delivery line on the invoice.

Nothing here is guessed. The central admin sets the price list (weight slabs, extra per kg, packing weight, GST) in the
admin screen, and each product's packed weight on its own row. Until that is done, delivery is simply not offered.

  weight   = sum(unit weight x quantity) + packing weight
  charge   = the slab the weight falls in; above the last slab: last slab + extra_per_kg for every started kg beyond it
  GST      = added on top of the charge (the invoice shows it as CGST + SGST on a "Delivery charges" line)

The customer pays products + delivery charges + GST in ONE online payment, and nothing is dispatched before it is confirmed.
"""

import math
import uuid
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import repositories as repo
from .db import get_session
from .models import AppSetting, Product
from .services import ExtraLine

KEY = "delivery"
router = APIRouter(prefix="/api/v1/store")
Sess = Annotated[Session, Depends(get_session)]


class Slab(BaseModel):
    model_config = ConfigDict(extra="forbid")
    up_to_grams: int = Field(ge=1, le=1_000_000)
    charge: Decimal = Field(ge=0, le=100_000, max_digits=10, decimal_places=2)


class DeliveryConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = False
    courier: str = Field(default="DTDC", max_length=30)
    packing_grams: int = Field(default=0, ge=0, le=100_000)  # box and packing material, added to every parcel
    slabs: list[Slab] = Field(default_factory=list, max_length=12)
    extra_per_kg: Decimal = Field(default=Decimal(0), ge=0, le=100_000, max_digits=10, decimal_places=2)
    gst_percent: Decimal = Field(default=Decimal(18), ge=0, le=28)  # on the delivery charge, split into CGST + SGST
    sac_code: str = Field(default="996812", pattern=r"^\d{4,8}$")  # courier services
    delivery_days: str = Field(default="2-3 working days", max_length=60)
    max_weight_grams: int = Field(default=0, ge=0, le=10_000_000)  # 0 = no limit
    # e.g. https://.../track?awb={awb}  (the courier's own page; {awb} becomes the consignment number). Empty = none is sent.
    tracking_url_template: str = Field(default="", max_length=300, pattern=r"^$|^https://\S+$")


def read_config(s: Session) -> DeliveryConfig:
    row = s.scalar(select(AppSetting).where(AppSetting.key == KEY))
    try:
        return DeliveryConfig(**(row.value if row else {}))
    except ValueError:
        return DeliveryConfig()  # a damaged setting means "delivery off", never a wrong price


def save_config(s: Session, cfg: DeliveryConfig) -> None:
    ordered = DeliveryConfig(**{**cfg.model_dump(mode="json"), "slabs": sorted((x.model_dump(mode="json") for x in cfg.slabs), key=lambda x: x["up_to_grams"])})
    row = s.scalar(select(AppSetting).where(AppSetting.key == KEY))
    if row is None:
        s.add(AppSetting(id=uuid.uuid4(), key=KEY, value=ordered.model_dump(mode="json")))
    else:
        row.value = ordered.model_dump(mode="json")


def charge_for(cfg: DeliveryConfig, grams: int) -> Decimal:
    """The delivery charge before GST for a parcel of this weight."""
    slabs = sorted(cfg.slabs, key=lambda x: x.up_to_grams)
    for slab in slabs:
        if grams <= slab.up_to_grams:
            return slab.charge
    last = slabs[-1]
    return last.charge + cfg.extra_per_kg * math.ceil((grams - last.up_to_grams) / 1000)


# ---- which of the three ways to order the store offers (the central admin switches them) ----
MODES_KEY = "checkout_modes"


def read_modes(s: Session) -> dict:
    """The admin's switches. Pay-at-branch and online-pick-up default to ON; delivery is the `enabled` flag of its own settings."""
    row = s.scalar(select(AppSetting).where(AppSetting.key == MODES_KEY))
    v = row.value if row else {}
    return {"pay_at_branch": bool(v.get("pay_at_branch", True)), "online_pickup": bool(v.get("online_pickup", True)),
            "delivery": read_config(s).enabled}


def save_modes(s: Session, *, pay_at_branch: bool, online_pickup: bool) -> None:
    value = {"pay_at_branch": pay_at_branch, "online_pickup": online_pickup}
    row = s.scalar(select(AppSetting).where(AppSetting.key == MODES_KEY))
    if row is None:
        s.add(AppSetting(id=uuid.uuid4(), key=MODES_KEY, value=value))
    else:
        row.value = value


def effective_modes(s: Session) -> dict:
    """What a shopper can actually choose right now: switched on AND possible (online needs Razorpay, delivery needs a price list)."""
    from . import razorpay

    m, cfg, online = read_modes(s), read_config(s), razorpay.enabled()
    return {"pay_at_branch": m["pay_at_branch"], "online_pickup": m["online_pickup"] and online,
            "delivery": m["delivery"] and bool(cfg.slabs) and online}


class Quote(BaseModel):
    available: bool
    reason: str = ""
    weight_grams: int = 0
    charge: Decimal = Decimal(0)  # before GST
    gst: Decimal = Decimal(0)
    total: Decimal = Decimal(0)  # charge + GST
    days: str = ""


def quote(cfg: DeliveryConfig, products: dict, lines: list[tuple[uuid.UUID, int]]) -> Quote:
    if not cfg.enabled or not cfg.slabs:
        return Quote(available=False, reason="Home delivery is not available yet.")
    grams = cfg.packing_grams
    for pid, qty in lines:
        pr: Product | None = products.get(pid)
        if pr is None:
            return Quote(available=False, reason="One of the products is no longer available.")
        if pr.weight_grams <= 0:
            return Quote(available=False, reason=f"Home delivery is not available for {' '.join(pr.name.split())} yet. You can collect it from a branch.")
        grams += pr.weight_grams * qty
    if cfg.max_weight_grams and grams > cfg.max_weight_grams:
        return Quote(available=False, reason="This order is too heavy for home delivery. Please collect it from a branch or split it into smaller orders.", weight_grams=grams)
    base = charge_for(cfg, grams).quantize(Decimal("0.01"), ROUND_HALF_UP)
    gst = (base * cfg.gst_percent / 100).quantize(Decimal("0.01"), ROUND_HALF_UP)
    return Quote(available=True, weight_grams=grams, charge=base, gst=gst, total=base + gst, days=cfg.delivery_days)


def delivery_line(cfg: DeliveryConfig, charge: Decimal) -> ExtraLine:
    half = cfg.gst_percent / 2
    return ExtraLine(particulars=f"Delivery charges ({cfg.courier})", hsn_code=cfg.sac_code, rate=charge, cgst_rate=half, sgst_rate=half)


class QuoteLine(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_id: uuid.UUID
    quantity: int = Field(ge=1, le=1_000_000)


class QuoteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[QuoteLine] = Field(min_length=1, max_length=40)


@router.post("/delivery-quote")
def delivery_quote(body: QuoteIn, s: Sess) -> Quote:
    """What delivering this basket would cost (the cart screen shows it before the shopper commits to anything)."""
    e = repo.current_event(s)
    if e is None:
        raise HTTPException(409, "The store is closed at the moment")
    ids = [i.product_id for i in body.items]
    return quote(read_config(s), repo.products_by_ids(s, e.id, ids), [(i.product_id, i.quantity) for i in body.items])
