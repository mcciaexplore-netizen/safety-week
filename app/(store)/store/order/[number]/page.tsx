"use client";

import { Suspense, use, useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, Download, Loader2, MapPin, Phone } from "lucide-react";
import { ErrorState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { OrderStatusPill } from "@/components/store/bits";
import { payForOrder } from "@/lib/store/razorpay";
import { downloadOrderInvoice, rupees, storeApi, StoreError, useStore, type Order } from "@/lib/store/client";
import { cn } from "@/lib/utils";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

function Timeline({ o }: { o: Order }) {
  const steps = [
    { label: "Order placed", at: o.created_at, done: true },
    { label: "Packed & ready for pick-up", at: o.ready_at, done: !!o.ready_at || o.status === "PICKED_UP" },
    { label: "Collected", at: o.picked_up_at, done: o.status === "PICKED_UP" },
  ];
  if (o.status === "CANCELLED" || o.status === "EXPIRED") return null;
  return (
    <ol className="grid gap-4 sm:grid-cols-3" aria-label="Order progress">
      {steps.map((s) => (
        <li key={s.label} className="flex items-start gap-3">
          <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border text-white", s.done ? "border-success bg-success" : "border-border bg-white text-transparent")}><Check className="size-3.5" /></span>
          <span className="text-sm"><span className={cn("block font-semibold", !s.done && "text-muted-foreground")}>{s.label}</span>{s.at && <span className="text-xs text-muted-foreground">{fmt(s.at)}</span>}</span>
        </li>
      ))}
    </ol>
  );
}

function OrderView({ number }: { number: string }) {
  const params = useSearchParams();
  const t = params.get("t");
  const { token, ready } = useStore();
  const [email, setEmail] = useState<string | null>(params.get("email"));
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const canTry = ready && (!!token || !!t || !!email);

  const query = useCallback(() => {
    const q = new URLSearchParams();
    if (t) q.set("t", t); else if (!token && email) q.set("email", email);
    return q.toString();
  }, [t, token, email]);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!canTry) return;
    let live = true;
    storeApi<Order>(`/orders/${number}?${query()}`, {}, token).then(
      (o) => { if (live) { setOrder(o); setError(null); } },
      (e: unknown) => { if (live) setError(e instanceof Error ? e.message : "Could not load the order."); },
    );
    return () => { live = false; };
  }, [canTry, number, query, token, nonce]);

  async function cancel() {
    if (!window.confirm("Cancel this order? Items go back on the shelf.")) return;
    setBusy("cancel");
    try { setOrder(await storeApi<Order>(`/orders/${number}/cancel?${query()}`, { method: "POST" }, token)); }
    catch (e) { window.alert(e instanceof StoreError ? e.message : "Could not cancel."); }
    finally { setBusy(null); }
  }
  async function payNow() {
    if (!order) return;
    setBusy("pay");
    try {
      const done = await payForOrder(order, { token, t });
      if (done) setOrder(done); else setNonce((n) => n + 1);
    } catch (e) { window.alert(e instanceof Error ? e.message : "The payment could not be completed."); setNonce((n) => n + 1); }
    finally { setBusy(null); }
  }
  async function invoice() {
    setBusy("pdf");
    try { await downloadOrderInvoice(number, { token, t, email }); }
    catch (e) { window.alert(e instanceof Error ? e.message : "Could not download."); }
    finally { setBusy(null); }
  }

  if (!ready) return <Skeleton className="h-64" />;
  if (!canTry || (error && !order && !token && !t))
    return (
      <form onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); setEmail(String(new FormData(e.currentTarget).get("email") ?? "").trim()); }} className="glass mx-auto max-w-md space-y-4 rounded-xl p-6">
        <h1 className="text-2xl">Find your order {number}</h1>
        <p className="text-sm text-muted-foreground">Enter the e-mail address you used when ordering.</p>
        <Input name="email" type="email" required placeholder="you@example.com" aria-label="E-mail address" />
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <Button type="submit" className="w-full">View order</Button>
      </form>
    );
  if (error && !order) return <ErrorState title="We could not find that order" message={error} onRetry={() => setNonce((n) => n + 1)} />;
  if (!order) return <Skeleton className="h-64" />;
  const o = order;
  const open = o.status === "PLACED" || o.status === "READY";
  const awaiting = o.status === "PENDING_PAYMENT";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label-xs">{params.get("t") && o.status === "PLACED" ? "Thank you — your order is placed" : "Order"}</p>
          <h1 className="mt-1 font-mono text-2xl font-bold" data-testid="order-number">{o.number}</h1>
          <p className="text-sm text-muted-foreground">Placed {fmt(o.created_at)}</p>
        </div>
        <OrderStatusPill status={o.status} />
      </div>

      <Timeline o={o} />

      {awaiting && (
        <div className="highlight-box space-y-3 text-sm" data-testid="awaiting-payment">
          <p>Your order is reserved but <strong>not paid yet</strong>. Complete the payment to confirm it{o.payment ? <> — we hold your items until {fmt(o.payment.pay_until)}</> : null}.</p>
          <Button onClick={payNow} disabled={busy === "pay"} data-testid="pay-now">
            {busy === "pay" ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}Pay {rupees(o.total)} now
          </Button>
        </div>
      )}
      {open && (
        <div className="highlight-box text-sm">
          {o.status === "READY" ? "Your order is packed and waiting for you." : "We are packing your order — we will e-mail you when it is ready."}{" "}
          Collect it from <strong>{o.branch.name}</strong> within the next few days (held until {fmt(o.hold_until)}).{" "}
          {o.payment_status === "UNPAID" ? <>Please bring <strong>{rupees(o.total)}</strong> — you pay at the counter.</> : "It is already paid online - there is nothing to pay at the branch."}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-[1fr_280px]">
        <section className="glass rounded-xl p-5">
          <h2 className="mb-3 text-lg">Items</h2>
          <ul className="divide-y text-sm">
            {o.items.map((i) => (
              <li key={i.name} className="flex justify-between gap-3 py-2"><span>{i.name} <span className="text-muted-foreground">× {i.quantity}</span></span><span className="tabular-nums">{rupees(i.amount)}</span></li>
            ))}
          </ul>
          <p className="mt-3 flex justify-between border-t pt-3 font-semibold"><span>Total (incl. GST)</span><span className="tabular-nums" data-testid="order-total">{rupees(o.total)}</span></p>
          <p className="mt-1 text-xs text-muted-foreground">{o.payment_method === "PAY_AT_PICKUP" ? "Payment: pay at pick-up" : "Payment: online (Razorpay)"} · {o.payment_status === "PAID" ? "Paid" : o.payment_status === "REFUNDED" ? "Refunded" : "Not yet paid"}</p>
        </section>
        <aside className="glass space-y-3 rounded-xl p-5 text-sm">
          <h2 className="text-lg">Pick-up branch</h2>
          <p className="flex gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-primary" /><span><strong>{o.branch.name}</strong><br />{o.branch.address}</span></p>
          {o.branch.phone && <p className="flex gap-2"><Phone className="size-4 text-primary" />{o.branch.phone}</p>}
          <Button variant="outline" className="w-full" onClick={invoice} disabled={busy === "pdf"}>
            {busy === "pdf" ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Download data-icon="inline-start" />}Download invoice
          </Button>
          {(open || awaiting) && o.payment_status === "UNPAID" && <Button variant="destructive" className="w-full" onClick={cancel} disabled={busy === "cancel"}>Cancel order</Button>}
        </aside>
      </div>
      <Link href="/store" className="inline-block text-sm font-semibold text-primary">Continue shopping</Link>
    </div>
  );
}

export default function OrderPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = use(params);
  return <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6"><Suspense fallback={<Skeleton className="h-64" />}><OrderView number={number} /></Suspense></div>;
}
