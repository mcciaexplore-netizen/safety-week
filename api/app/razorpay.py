"""Razorpay (https://razorpay.com/docs/api): the few calls the store needs, over plain HTTPS - no SDK.

We never see card / UPI details: the shopper pays inside Razorpay's own window. We only
  * create an order for the exact amount (server side, from OUR total - never from the browser),
  * check the signature Razorpay returns, and confirm the payment with Razorpay itself,
  * verify Razorpay's webhook, and
  * send refunds.
Keys come from RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET (test keys start with rzp_test_). The webhook has its own secret.
"""

import hashlib
import hmac
from decimal import Decimal

import httpx

from .config import settings

BASE = "https://api.razorpay.com/v1"


class RazorpayError(Exception):
    """Razorpay said no, or could not be reached."""


def enabled() -> bool:
    return bool(settings.razorpay_key_id and settings.razorpay_key_secret)


def paise(amount: Decimal | float | int | str) -> int:
    return int((Decimal(str(amount)) * 100).to_integral_value())


def _call(method: str, path: str, **kw) -> dict:
    if not enabled():
        raise RazorpayError("Online payment is not set up")
    try:
        r = httpx.request(method, f"{BASE}{path}", auth=(settings.razorpay_key_id, settings.razorpay_key_secret), timeout=20, **kw)
    except httpx.HTTPError as e:
        raise RazorpayError("Could not reach Razorpay") from e
    if r.status_code >= 400:
        try:
            msg = r.json().get("error", {}).get("description") or r.text[:200]
        except ValueError:
            msg = r.text[:200]
        raise RazorpayError(msg)
    return r.json()


def create_order(amount_paise: int, receipt: str, notes: dict | None = None) -> dict:
    return _call("POST", "/orders", json={"amount": amount_paise, "currency": "INR", "receipt": receipt[:40], "notes": notes or {}})


def fetch_payment(payment_id: str) -> dict:
    return _call("GET", f"/payments/{payment_id}")


def capture(payment_id: str, amount_paise: int) -> dict:
    return _call("POST", f"/payments/{payment_id}/capture", json={"amount": amount_paise, "currency": "INR"})


def refund(payment_id: str, amount_paise: int, notes: dict | None = None) -> dict:
    return _call("POST", f"/payments/{payment_id}/refund", json={"amount": amount_paise, "notes": notes or {}})


def create_qr(amount_paise: int, name: str, description: str, notes: dict | None = None, close_by: int | None = None) -> dict:
    """A single-use UPI QR code for exactly this amount (the counter payment)."""
    body = {"type": "upi_qr", "name": name[:40], "usage": "single_use", "fixed_amount": True, "payment_amount": amount_paise,
            "description": description[:100], "notes": notes or {}}
    if close_by:
        body["close_by"] = close_by
    return _call("POST", "/payments/qr_codes", json=body)


def fetch_qr(qr_id: str) -> dict:
    return _call("GET", f"/payments/qr_codes/{qr_id}")


def qr_payments(qr_id: str) -> list[dict]:
    return _call("GET", f"/payments/qr_codes/{qr_id}/payments").get("items", [])


def _same(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


def verify_signature(order_id: str, payment_id: str, signature: str) -> bool:
    """The browser's proof of payment: HMAC-SHA256 of "order_id|payment_id" with our key secret."""
    if not settings.razorpay_key_secret or not signature:
        return False
    good = hmac.new(settings.razorpay_key_secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()
    return _same(good, signature)


def verify_webhook(body: bytes, signature: str) -> bool:
    """Razorpay's own message to our server: HMAC-SHA256 of the raw body with the webhook secret."""
    if not settings.razorpay_webhook_secret or not signature:
        return False
    good = hmac.new(settings.razorpay_webhook_secret.encode(), body, hashlib.sha256).hexdigest()
    return _same(good, signature)
