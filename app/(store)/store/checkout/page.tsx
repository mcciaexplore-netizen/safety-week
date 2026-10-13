"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Banknote, CreditCard, Loader2, MapPin, Truck } from "lucide-react";
import { ErrorState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EnquireButton } from "@/components/store/availability";
import { payForOrder } from "@/lib/store/razorpay";
import { cn } from "@/lib/utils";
import { cartLines, cartTotals, rupees, storeActions, storeApi, StoreError, useCatalogue, useStore, type DeliveryQuote, type Order } from "@/lib/store/client";

export default function CheckoutPage() {
  const router = useRouter();
  const { data, error, reload } = useCatalogue();
  const { cart, branch, token, customer, ready } = useStore();
  const [name, setName] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [option, setOption] = useState<"OFFLINE" | "ONLINE" | "DELIVERY" | null>(null);
  const [ship, setShip] = useState({ address: "", city: "", state: "", pincode: "" });
  const [quoted, setQuoted] = useState<{ key: string; q: DeliveryQuote } | null>(null);
  const [problem, setProblem] = useState<{ message: string; short?: StoreError["short"] } | null>(null);

  const cartKey = JSON.stringify(cart);
  const wantDelivery = option === "DELIVERY";
  const quote = quoted && quoted.key === cartKey ? quoted.q : null;  // never show a charge worked out for a different cart
  useEffect(() => {
    if (!wantDelivery || !data) return;
    const items = cartLines(data, cart).map((l) => ({ product_id: l.product.id, quantity: l.qty }));
    if (items.length === 0) return;
    let live = true;
    storeApi<DeliveryQuote>("/delivery-quote", { method: "POST", body: JSON.stringify({ items }) })
      .then((q) => { if (live) setQuoted({ key: cartKey, q }); })
      .catch(() => { if (live) setQuoted({ key: cartKey, q: { available: false, reason: "We could not work out the delivery charge. Please try again.", weight_grams: 0, charge: "0", gst: "0", total: "0", days: "" } }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantDelivery, cartKey, !!data]);

  if (error) return <div className="mx-auto max-w-3xl px-4 py-16"><ErrorState message={error} onRetry={reload} /></div>;
  if (!data || !ready) return <div className="mx-auto max-w-5xl px-4 py-12"><Skeleton className="h-96" /></div>;
  const lines = cartLines(data, cart);
  if (lines.length === 0)
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-3xl">Your cart is empty</h1>
        <Link href="/store" className="mt-4 inline-block font-semibold text-primary">Back to the store</Link>
      </div>
    );
  const t = cartTotals(lines);
  const chosen = data.branches.find((b) => b.code === branch) ?? null;
  const nameV = name ?? customer?.name ?? "";
  const emailV = email ?? customer?.email ?? "";
  const phoneV = phone ?? customer?.phone ?? "";

  const canOnline = !!data.online_payments;
  const canDeliver = canOnline && !!data.delivery?.enabled;
  const choice = option ?? (canOnline ? "ONLINE" : "OFFLINE");
  const delivering = choice === "DELIVERY" && canDeliver;
  const online = canOnline && choice !== "OFFLINE";
  const deliveryOk = !delivering || (!!quote && quote.available);
  const payable = delivering && quote?.available ? Math.round(t.total + Number(quote.total)) : t.total;

  async function place(e: FormEvent) {
    e.preventDefault();
    if (!branch) { setProblem({ message: delivering ? "Please choose the branch your order is sent from." : "Please choose the branch you will collect from." }); return; }
    if (delivering && !deliveryOk) { setProblem({ message: quote?.reason || "Delivery is not available for this order." }); return; }
    setBusy(true);
    setProblem(null);
    try {
      const order = await storeApi<Order>("/orders", {
        method: "POST",
        body: JSON.stringify({
          branch_code: branch, name: nameV.trim(), email: emailV.trim(), phone: phoneV.trim(), payment_method: online ? "ONLINE" : "PAY_AT_PICKUP", note: note.trim(),
          fulfilment: delivering ? "DELIVERY" : "PICKUP",
          ...(delivering ? { ship_to: { address: ship.address.trim(), city: ship.city.trim(), state: ship.state.trim(), pincode: ship.pincode.trim() } } : {}),
          items: lines.map((l) => ({ product_id: l.product.id, quantity: l.qty })),
        }),
      }, token);
      storeActions.clear();
      const go = (n: string) => router.push(`/store/order/${n}?t=${encodeURIComponent(order.access_token ?? "")}`);
      if (online && order.payment) {
        // the order and its stock are held; Razorpay's own window takes the payment, then our server confirms it
        try { await payForOrder(order, { token, t: order.access_token }); } catch { /* the order page shows what happened and offers "Pay now" */ }
      }
      go(order.number);
    } catch (err) {
      setProblem({ message: err instanceof Error ? err.message : "Could not place the order.", short: err instanceof StoreError ? err.short : undefined });
      setBusy(false);
      if (err instanceof StoreError && err.short) reload();
    }
  }

  return (
    <form onSubmit={place} className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="mb-6 text-[clamp(1.8rem,3.5vw,2.5rem)] font-extrabold">Checkout</h1>
      <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <section className="glass space-y-3 rounded-xl p-5 sm:p-6">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-lg">1. {delivering ? "Dispatch branch" : "Pick-up branch"}</h2>
              <Link href="/store/cart" className="text-sm font-semibold text-primary" data-testid="change-branch">Change in cart</Link>
            </div>
            {chosen ? (
              <div className="flex gap-3 rounded-xl border border-primary bg-white/70 p-4 ring-[3px] ring-primary/10" data-testid={`branch-${chosen.code}`}>
                <MapPin className="mt-0.5 size-5 shrink-0 text-primary" />
                <div className="min-w-0 text-sm">
                  <p className="font-heading font-bold">{chosen.name}</p>
                  <p className="text-xs text-muted-foreground">{chosen.address}</p>
                  {chosen.phone && <p className="text-xs text-muted-foreground">{chosen.phone}</p>}
                </div>
              </div>
            ) : (
              <p role="alert" className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
                Please choose your branch in the <Link href="/store/cart" className="font-semibold underline">cart</Link> first, so we can check its live stock.
              </p>
            )}
          </section>

          <section className="glass space-y-4 rounded-xl p-5 sm:p-6">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg">2. Your details</h2>
              {!token && <Link href="/store/account?next=/store/checkout" className="text-sm font-semibold text-primary">Sign in for faster checkout</Link>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="c-name">Full name</Label><Input id="c-name" required maxLength={200} value={nameV} onChange={(e) => setName(e.target.value)} autoComplete="name" /></div>
              <div className="space-y-1.5"><Label htmlFor="c-phone">Mobile number</Label><Input id="c-phone" required inputMode="tel" pattern="[0-9+ \-]{8,20}" title="8-20 digits" value={phoneV} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" /></div>
              <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="c-email">E-mail (your invoice is sent here)</Label><Input id="c-email" type="email" required value={emailV} readOnly={!!customer} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></div>
              <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="c-note">Note for the branch (optional)</Label><Input id="c-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></div>
            </div>
          </section>

          <section className="glass space-y-4 rounded-xl p-5 sm:p-6">
            <h2 className="text-lg">3. How do you want your order?</h2>
            <div role="radiogroup" aria-label="Payment and collection" className="space-y-3">
              {([
                { id: "OFFLINE" as const, icon: Banknote, title: "Pay at the branch and pick up", line: "Reserve now, pay at the counter when you collect",
                  note: `We hold your items for ${data.pickup_hold_days ?? 3} days. Your order is only confirmed as paid when you pay at the branch.`, ok: true },
                { id: "ONLINE" as const, icon: CreditCard, title: "Pay online and pick up from the branch", line: "Pay with Razorpay, then collect from your branch",
                  note: "UPI, cards and net banking in Razorpay's secure window. Your order is placed only once the payment is received; then your invoice is e-mailed.", ok: canOnline },
                { id: "DELIVERY" as const, icon: Truck, title: `Pay online and get it delivered (${data.delivery?.days ?? "2-3 working days"})`, line: "Delivered to your address by courier; delivery charge is added by weight",
                  note: "You must pay online before it is sent. We e-mail your invoice and the tracking link when it ships.", ok: canDeliver },
              ]).filter((o) => o.ok).map(({ id, icon: Icon, title, line, note }) => {
                const on = choice === id;
                return (
                  <label key={id} data-testid={`option-${id}`} className={cn("flex cursor-pointer gap-3 rounded-xl border bg-white/70 p-4 transition", on ? "border-primary ring-[3px] ring-primary/10" : "hover:border-primary/40")}>
                    <input type="radio" name="fulfil" className="mt-1 size-4 accent-[var(--color-primary)]" checked={on} onChange={() => { setOption(id); setProblem(null); }} />
                    <Icon className="mt-0.5 size-5 shrink-0 text-primary" />
                    <span className="text-sm">
                      <span className="block font-heading font-bold">{title}</span>
                      <span className="mt-0.5 block font-medium">{line}</span>
                      <span className="block text-xs text-muted-foreground">{note}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {!canOnline && <p className="text-xs text-muted-foreground">Online payment is not set up on this server, so only “pay at the branch” is available.</p>}
          </section>

          {delivering && (
            <section className="glass space-y-4 rounded-xl p-5 sm:p-6" data-testid="delivery-address">
              <h2 className="text-lg">4. Delivery address</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="d-addr">Full address (house / flat, street, area, landmark)</Label><Input id="d-addr" required minLength={10} maxLength={300} value={ship.address} onChange={(e) => setShip({ ...ship, address: e.target.value })} autoComplete="street-address" /></div>
                <div className="space-y-1.5"><Label htmlFor="d-city">City</Label><Input id="d-city" required maxLength={100} value={ship.city} onChange={(e) => setShip({ ...ship, city: e.target.value })} autoComplete="address-level2" /></div>
                <div className="space-y-1.5"><Label htmlFor="d-state">State</Label><Input id="d-state" required maxLength={100} value={ship.state} onChange={(e) => setShip({ ...ship, state: e.target.value })} autoComplete="address-level1" /></div>
                <div className="space-y-1.5"><Label htmlFor="d-pin">PIN code</Label><Input id="d-pin" required inputMode="numeric" pattern="[1-9][0-9]{5}" title="6-digit PIN code" maxLength={6} value={ship.pincode} onChange={(e) => setShip({ ...ship, pincode: e.target.value.replace(/\D/g, "") })} autoComplete="postal-code" /></div>
              </div>
              <p className="text-xs text-muted-foreground">We deliver to this address only after your payment is received. The courier will call the mobile number above.</p>
            </section>
          )}
        </div>

        <aside className="glass h-fit space-y-4 rounded-xl p-5 lg:sticky lg:top-24">
          <h2 className="text-lg">Order summary</h2>
          <ul className="space-y-1 text-sm">
            {lines.map(({ product: p, qty }) => <li key={p.id} className="flex justify-between gap-3"><span className="truncate">{p.name} × {qty}</span></li>)}
          </ul>
          <dl className="space-y-2 border-t pt-3 text-sm tabular-nums">
            <div className="flex justify-between"><dt className="text-muted-foreground">Items</dt><dd>{rupees(t.basic)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">GST</dt><dd>{rupees(t.gst)}</dd></div>
            {delivering && (quote?.available ? (
              <>
                <div className="flex justify-between"><dt className="text-muted-foreground">Delivery ({(quote.weight_grams / 1000).toFixed(2)} kg)</dt><dd>{rupees(quote.charge)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">GST on delivery</dt><dd>{rupees(quote.gst)}</dd></div>
              </>
            ) : <div className="text-xs text-muted-foreground" data-testid="delivery-quote-state">{quote ? "" : "Working out the delivery charge…"}</div>)}
            <div className="flex justify-between border-t pt-2 text-base font-semibold"><dt>To pay{delivering ? " (rounded)" : ""}</dt><dd>{rupees(payable)}</dd></div>
          </dl>
          {delivering && quote && !quote.available && <p role="alert" data-testid="delivery-unavailable" className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">{quote.reason}</p>}
          {problem && (
            <div role="alert" data-testid="checkout-error" className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-danger">
              {problem.short ? "We cannot complete this order yet:" : problem.message}
              {problem.short && <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">{problem.short.map((s) => <li key={s.product_id}>{s.message}</li>)}</ul>}
              {problem.short && <EnquireButton className="mt-3" />}
            </div>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={busy || !data.open || !branch || !deliveryOk} data-testid="place-order">
            {busy && <Loader2 className="animate-spin" data-icon="inline-start" />}{delivering ? `Pay ${rupees(payable)} and deliver` : online ? `Pay ${rupees(payable)} online` : "Reserve order (pay at branch)"}
          </Button>
          {!data.open && <p className="text-xs text-warning">The store is not taking orders right now.</p>}
          <p className="text-xs text-muted-foreground">{delivering ? "Your order is placed only after your payment is received. Then your invoice is e-mailed, and the tracking link follows when it ships." : online ? "Your order is placed only after your payment is received. Then your invoice is e-mailed and it is packed for pick-up." : `Your order is held for ${data.pickup_hold_days ?? 3} days. You pay at the branch counter when you collect it.`}</p>
        </aside>
      </div>
    </form>
  );
}
