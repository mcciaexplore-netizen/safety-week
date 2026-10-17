"""Home delivery by courier: weight -> charge -> one online payment -> nothing is sent until it is paid -> tracking e-mail."""

import pytest
from sqlalchemy import text

from app import mailer
from app.db import engine
from tests.test_store import API, S, order_body, prods, remaining, stock_for  # noqa: F401  (prods is a fixture)
from tests.test_store_pay import POSTER, rz, sig  # noqa: F401  (rz is a fixture)

ADDRESS = {"address": "Flat 4, Green Park, Kothrud", "city": "Pune", "state": "Maharashtra", "pincode": "411038"}
CONFIG = {"enabled": True, "courier": "DTDC", "packing_grams": 100, "extra_per_kg": "40.00", "gst_percent": "18", "sac_code": "996812",
          "delivery_days": "2-3 working days", "max_weight_grams": 0, "tracking_url_template": "https://track.example.com/t?awb={awb}",
          "slabs": [{"up_to_grams": 500, "charge": "60.00"}, {"up_to_grams": 1000, "charge": "100.00"}, {"up_to_grams": 2000, "charge": "150.00"}]}


@pytest.fixture()
def delivery_on(client, people, prods):
    """Weights and a price list set up, and put back afterwards so other tests see delivery as off."""
    with engine.begin() as c:
        c.execute(text("update products set weight_grams = 250 where name like :n"), {"n": f"{POSTER}%"})
    assert client.put(f"{API}/admin/delivery-settings", json=CONFIG, headers=people["super"]["h"]).status_code == 200
    yield
    with engine.begin() as c:
        c.execute(text("update products set weight_grams = 0"))
        c.execute(text("delete from app_settings where key = 'delivery'"))


def quote(client, prods, qty, name=POSTER):
    return client.post(f"{S}/delivery-quote", json={"items": [{"product_id": prods[name], "quantity": qty}]}).json()


def deliver_body(prods, qty=2, **extra):
    return order_body(prods, lines=((POSTER, qty),), email="deliver@example.com", payment_method="ONLINE", fulfilment="DELIVERY", ship_to=ADDRESS, **extra)


def test_delivery_is_off_until_weights_and_prices_are_set(client, people, prods, rz):  # noqa: F811
    assert quote(client, prods, 1)["available"] is False
    assert client.get(f"{S}/catalogue").json()["delivery"]["enabled"] is False
    r = client.post(f"{S}/orders", json=deliver_body(prods))
    assert r.status_code == 409 and "switched off" in r.text


def test_charge_is_worked_out_from_the_weight(client, people, prods, delivery_on):
    q = quote(client, prods, 2)                                   # 2 x 250 + 100 packing = 600 g -> the 1 kg slab
    assert (q["available"], q["weight_grams"], q["charge"], q["gst"], q["total"], q["days"]) == (True, 600, "100.00", "18.00", "118.00", "2-3 working days")
    assert quote(client, prods, 1)["charge"] == "60.00"          # 350 g
    assert quote(client, prods, 15)["charge"] == "230.00"        # 3850 g: 150 + 2 more started kg x 40
    assert client.get(f"{S}/catalogue").json()["delivery"] == {"enabled": True, "days": "2-3 working days"}
    other = next(n for n in prods if n != POSTER and not n.startswith(POSTER))
    assert quote(client, prods, 1, other)["available"] is False   # a product without a weight cannot be delivered


def test_shoppers_see_each_products_packed_weight(client, people, prods, delivery_on):
    shown = {p["name"]: p["weight_grams"] for p in client.get(f"{S}/catalogue").json()["products"]}
    assert shown[POSTER] == 250                                    # set by the admin, shown on the store card
    assert 0 in shown.values()                                     # not set yet -> 0, the store shows no weight line


def test_bundle_products_are_sold_in_whole_packs(client, people, prods):
    with engine.begin() as c:
        c.execute(text("update products set pack_size = 50 where name like :n"), {"n": f"{POSTER}%"})
    try:
        stock_for(client, people, prods, "TIL", POSTER, 200)
        assert {p["name"]: p["pack_size"] for p in client.get(f"{S}/catalogue").json()["products"]}[POSTER] == 50
        r = client.post(f"{S}/orders", json=order_body(prods, lines=((POSTER, 7),)))
        assert r.status_code == 422 and "packs of 50" in r.text      # a loose quantity is refused by the server, not just the screen
        r = client.post(f"{S}/orders", json=order_body(prods, lines=((POSTER, 100),)))
        assert r.status_code in (200, 201) and "packs of" not in r.text   # two whole packs go through
    finally:
        with engine.begin() as c:
            c.execute(text("update products set pack_size = 1"))


def test_delivery_rules_are_enforced_by_the_server(client, people, prods, delivery_on):
    stock_for(client, people, prods, "TIL", POSTER, 10)
    no_address = {k: v for k, v in deliver_body(prods).items() if k != "ship_to"}
    assert client.post(f"{S}/orders", json=no_address).status_code == 422
    assert client.post(f"{S}/orders", json={**deliver_body(prods), "payment_method": "PAY_AT_PICKUP"}).status_code == 422   # delivery is paid first, always
    assert client.post(f"{S}/orders", json={**deliver_body(prods), "ship_to": {**ADDRESS, "pincode": "12"}}).status_code == 422
    assert client.post(f"{S}/orders", json=order_body(prods, lines=((POSTER, 1),), ship_to=ADDRESS)).status_code == 422     # an address on a pick-up order
    assert remaining(client, people, "TIL", POSTER) == 10                                                                      # none of them held any stock


def test_nothing_is_sent_before_the_payment_arrives(client, people, prods, rz, delivery_on):  # noqa: F811
    stock_for(client, people, prods, "TIL", POSTER, 10)
    mailer.OUTBOX.clear()
    r = client.post(f"{S}/orders", json=deliver_body(prods))
    assert r.status_code == 201, r.text
    o = r.json()
    assert (o["status"], o["fulfilment"], o["payment_status"]) == ("PENDING_PAYMENT", "DELIVERY", "UNPAID")
    assert o["delivery"]["charge"] == "100.00" and o["delivery"]["weight_grams"] == 600 and o["delivery"]["pincode"] == "411038"
    assert o["total"] == "425.00" and o["payment"]["amount"] == 42500        # 306.80 products + 118.00 delivery = 424.80 -> 425
    assert [(i["name"], i["quantity"]) for i in o["items"]] == [(o["items"][0]["name"], 2), ("Delivery charges (DTDC)", 1)]
    assert o["item_count"] == 2 and remaining(client, people, "TIL", POSTER) == 8 and not mailer.OUTBOX

    til = people["til"]["h"]
    row = next(x for x in client.get(f"{API}/store-orders", headers=til, params={"status": "PENDING_PAYMENT"}).json() if x["number"] == o["number"])
    ship = lambda: client.post(f"{API}/store-orders/{row['id']}/ship", headers=til, json={"tracking_no": "D1000234"})
    assert ship().status_code == 409                                         # unpaid: it must not be sent
    assert client.post(f"{API}/store-orders/{row['id']}/pickup", headers=til, json={"payment_mode": "CASH"}).status_code == 409   # nor handed over as a pick-up

    rid, t = o["payment"]["razorpay_order_id"], o["access_token"]
    pid = rz.pay(rid)
    paid = client.post(f"{S}/orders/{o['number']}/pay/verify", params={"t": t},
                       json={"razorpay_order_id": rid, "razorpay_payment_id": pid, "razorpay_signature": sig(rid, pid)})
    assert paid.status_code == 200 and (paid.json()["status"], paid.json()["payment_status"]) == ("PLACED", "PAID")
    mail = mailer.OUTBOX[-1]
    assert "will be delivered" in mail.subject and "411038" in mail.text and "2-3 working days" in mail.text and mail.attachments[0][1].startswith(b"%PDF")

    assert client.post(f"{API}/store-orders/{row['id']}/pickup", headers=til, json={"payment_mode": "CASH"}).status_code == 409   # still not a pick-up
    assert client.post(f"{API}/store-orders/{row['id']}/delivered", headers=til).status_code == 409                               # not shipped yet
    assert client.post(f"{API}/store-orders/{row['id']}/ship", headers=til, json={"tracking_no": "ab"}).status_code == 422           # a real number is needed
    assert client.post(f"{API}/store-orders/{row['id']}/ship", headers=people["sbr"]["h"], json={"tracking_no": "D1000234"}).status_code == 404   # another branch's order
    mailer.OUTBOX.clear()
    shipped = ship()
    assert shipped.status_code == 200 and shipped.json()["status"] == "SHIPPED"
    d = shipped.json()["delivery"]
    assert d["tracking_no"] == "D1000234" and d["tracking_url"] == "https://track.example.com/t?awb=D1000234" and d["shipped_at"]
    mail = mailer.OUTBOX[-1]
    assert "shipped" in mail.subject and "D1000234" in mail.text and "https://track.example.com/t?awb=D1000234" in mail.text
    assert mail.attachments[0][1].startswith(b"%PDF")
    assert ship().status_code == 409                                         # once only
    own = client.post(f"{API}/store-orders/{row['id']}/delivered", headers=til)
    assert own.status_code == 200 and own.json()["status"] == "DELIVERED" and own.json()["delivery"]["delivered_at"]


def test_a_courier_url_given_by_staff_wins_over_the_template(client, people, prods, rz, delivery_on):  # noqa: F811
    stock_for(client, people, prods, "TIL", POSTER, 10)
    o = client.post(f"{S}/orders", json=deliver_body(prods, qty=1)).json()
    rid = o["payment"]["razorpay_order_id"]
    pid = rz.pay(rid)
    client.post(f"{S}/orders/{o['number']}/pay/verify", params={"t": o["access_token"]},
                json={"razorpay_order_id": rid, "razorpay_payment_id": pid, "razorpay_signature": sig(rid, pid)})
    til = people["til"]["h"]
    row = next(x for x in client.get(f"{API}/store-orders", headers=til, params={"status": "OPEN"}).json() if x["number"] == o["number"])
    r = client.post(f"{API}/store-orders/{row['id']}/ship", headers=til, json={"tracking_no": "D77", "tracking_url": "https://www.dtdc.example/track/D77"})
    assert r.status_code == 200 and r.json()["delivery"]["tracking_url"] == "https://www.dtdc.example/track/D77"


def test_only_the_central_admin_sets_up_delivery(client, people, prods):
    assert client.put(f"{API}/admin/delivery-settings", json=CONFIG, headers=people["til_admin"]["h"]).status_code == 403
    assert client.put(f"{API}/admin/delivery-settings", json={**CONFIG, "slabs": []}, headers=people["super"]["h"]).status_code == 422   # on, but no prices
    assert client.put(f"{API}/admin/delivery-settings", json={**CONFIG, "enabled": False, "slabs": []}, headers=people["super"]["h"]).status_code == 200
    with engine.begin() as c:
        c.execute(text("delete from app_settings where key = 'delivery'"))


@pytest.fixture()
def modes_reset():
    yield
    with engine.begin() as c:
        c.execute(text("delete from app_settings where key = 'checkout_modes'"))


def test_the_central_admin_switches_each_way_of_ordering(client, people, prods, rz, delivery_on, modes_reset):  # noqa: F811
    su = people["super"]["h"]
    stock_for(client, people, prods, "TIL", POSTER, 20)
    url = f"{API}/admin/checkout-modes"
    got = client.get(url, headers=su).json()
    assert (got["pay_at_branch"], got["online_pickup"], got["delivery"], got["delivery_ready"], got["online_ready"]) == (True, True, True, True, True)
    assert client.get(f"{S}/catalogue").json()["modes"] == {"pay_at_branch": True, "online_pickup": True, "delivery": True}
    assert client.put(url, json={"pay_at_branch": True, "online_pickup": True, "delivery": True}, headers=people["til_admin"]["h"]).status_code == 403
    assert client.put(url, json={"pay_at_branch": False, "online_pickup": False, "delivery": False}, headers=su).status_code == 422   # at least one stays on

    pickup = lambda method: client.post(f"{S}/orders", json=order_body(prods, lines=((POSTER, 1),), email="modes@example.com", payment_method=method))
    assert client.put(url, json={"pay_at_branch": False, "online_pickup": True, "delivery": True}, headers=su).status_code == 200
    assert client.get(f"{S}/catalogue").json()["modes"]["pay_at_branch"] is False
    off = pickup("PAY_AT_PICKUP")
    assert off.status_code == 409 and "switched off" in off.text                       # refused by the server, not just hidden
    assert pickup("ONLINE").status_code == 201

    assert client.put(url, json={"pay_at_branch": True, "online_pickup": False, "delivery": True}, headers=su).status_code == 200
    assert pickup("ONLINE").status_code == 409 and pickup("PAY_AT_PICKUP").status_code == 201
    assert client.post(f"{S}/orders", json=deliver_body(prods)).status_code == 201     # delivery still on

    assert client.put(url, json={"pay_at_branch": True, "online_pickup": True, "delivery": False}, headers=su).status_code == 200
    assert client.get(f"{S}/catalogue").json()["modes"]["delivery"] is False
    assert client.post(f"{S}/orders", json=deliver_body(prods)).status_code == 409
    assert client.get(f"{API}/admin/delivery-settings", headers=su).json()["enabled"] is False   # the same switch as on the Delivery page
    assert client.put(url, json={"pay_at_branch": True, "online_pickup": True, "delivery": True}, headers=su).status_code == 200


def test_delivery_cannot_be_switched_on_without_a_price_list(client, people, modes_reset):
    r = client.put(f"{API}/admin/checkout-modes", json={"pay_at_branch": True, "online_pickup": True, "delivery": True}, headers=people["super"]["h"])
    assert r.status_code == 422 and "price list" in r.text
