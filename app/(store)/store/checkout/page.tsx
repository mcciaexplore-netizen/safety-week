"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CreditCard, Loader2, MapPin } from "lucide-react";
import { ErrorState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EnquireButton } from "@/components/store/availability";
import { payForOrder } from "@/lib/store/razorpay";
import { cartLines, cartTotals, rupees, storeActions, storeApi, StoreError, useCatalogue, useStore, type Order } from "@/lib/store/client";

export default function CheckoutPage() {
  const router = useRouter();
  const { data, error, reload } = useCatalogue();
  const { cart, branch, token, customer, ready } = useStore();
  const [name, setName] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; short?: StoreError["short"] } | null>(null);

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

  const online = !!data.online_payments;

  async function place(e: FormEvent) {
    e.preventDefault();
    if (!branch) { setProblem({ message: "Please choose the branch you will collect from." }); return; }
    setBusy(true);
    setProblem(null);
    try {
      const order = await storeApi<Order>("/orders", {
        method: "POST",
        body: JSON.stringify({
          branch_code: branch, name: nameV.trim(), email: emailV.trim(), phone: phoneV.trim(), payment_method: online ? "ONLINE" : "PAY_AT_PICKUP", note: note.trim(),
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
              <h2 className="text-lg">1. Pick-up branch</h2>
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
                Please choose your pick-up branch in the <Link href="/store/cart" className="font-semibold underline">cart</Link> first, so we can check its live stock.
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
            <h2 className="text-lg">3. How will you pay?</h2>
            {/* one way to pay: online through Razorpay, then collect. (Without Razorpay keys, i.e. development only, orders fall back to pay-at-pick-up.) */}
            <div className="flex gap-3 rounded-xl border border-primary bg-white/70 p-4 ring-[3px] ring-primary/10" data-testid="pay-online">
              <CreditCard className="mt-0.5 size-5 shrink-0 text-primary" />
              <div className="text-sm">
                <p className="font-heading font-bold">{online ? "Pay online and pick up" : "Pay at pick-up"}</p>
                <p className="mt-0.5 font-medium">{online ? "Pay with Razorpay" : "Pay at the branch counter when you collect"}</p>
                <p className="text-xs text-muted-foreground">
                  {online ? "UPI, cards and net banking in Razorpay's secure window. Once paid, your invoice is e-mailed and your order is packed for you to collect." : "Online payment is not set up on this server."}
                </p>
              </div>
            </div>
          </section>
        </div>

        <aside className="glass h-fit space-y-4 rounded-xl p-5 lg:sticky lg:top-24">
          <h2 className="text-lg">Order summary</h2>
          <ul className="space-y-1 text-sm">
            {lines.map(({ product: p, qty }) => <li key={p.id} className="flex justify-between gap-3"><span className="truncate">{p.name} × {qty}</span></li>)}
          </ul>
          <dl className="space-y-2 border-t pt-3 text-sm tabular-nums">
            <div className="flex justify-between"><dt className="text-muted-foreground">Items</dt><dd>{rupees(t.basic)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">GST</dt><dd>{rupees(t.gst)}</dd></div>
            <div className="flex justify-between border-t pt-2 text-base font-semibold"><dt>To pay</dt><dd>{rupees(t.total)}</dd></div>
          </dl>
          {problem && (
            <div role="alert" data-testid="checkout-error" className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-danger">
              {problem.short ? "We cannot complete this order yet:" : problem.message}
              {problem.short && <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">{problem.short.map((s) => <li key={s.product_id}>{s.message}</li>)}</ul>}
              {problem.short && <EnquireButton className="mt-3" />}
            </div>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={busy || !data.open || !branch} data-testid="place-order">
            {busy && <Loader2 className="animate-spin" data-icon="inline-start" />}{online ? `Pay ${rupees(t.total)} online` : "Place order"}
          </Button>
          {!data.open && <p className="text-xs text-warning">The store is not taking orders right now.</p>}
          <p className="text-xs text-muted-foreground">{online ? "After paying, your invoice is e-mailed to you and your order is packed for pick-up." : `Your order is held for ${data.pickup_hold_days ?? 3} days. You will get an e-mail with your invoice straight away.`}</p>
        </aside>
      </div>
    </form>
  );
}
