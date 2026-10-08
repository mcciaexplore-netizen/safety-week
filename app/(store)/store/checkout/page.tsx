"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Banknote, CheckCircle2, CreditCard, Loader2, MapPin } from "lucide-react";
import { ErrorState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cartLines, cartTotals, rupees, shortages, storeActions, storeApi, StoreError, useCatalogue, useStore, type Order } from "@/lib/store/client";
import { cn } from "@/lib/utils";

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
  const nameV = name ?? customer?.name ?? "";
  const emailV = email ?? customer?.email ?? "";
  const phoneV = phone ?? customer?.phone ?? "";
  const branchShort = branch ? shortages(lines, branch) : [];

  async function place(e: FormEvent) {
    e.preventDefault();
    if (!branch) { setProblem({ message: "Please choose the branch you will collect from." }); return; }
    setBusy(true);
    setProblem(null);
    try {
      const order = await storeApi<Order>("/orders", {
        method: "POST",
        body: JSON.stringify({
          branch_code: branch, name: nameV.trim(), email: emailV.trim(), phone: phoneV.trim(), payment_method: "PAY_AT_PICKUP", note: note.trim(),
          items: lines.map((l) => ({ product_id: l.product.id, quantity: l.qty })),
        }),
      }, token);
      storeActions.clear();
      router.push(`/store/order/${order.number}?t=${encodeURIComponent(order.access_token ?? "")}`);
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
          <section className="glass space-y-4 rounded-xl p-5 sm:p-6">
            <h2 className="text-lg">1. Where will you collect from?</h2>
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Pick-up branch">
              {data.branches.map((b) => {
                const sh = shortages(lines, b.code);
                const ok = sh.length === 0;
                return (
                  <label key={b.code} data-testid={`branch-${b.code}`} className={cn("flex cursor-pointer gap-3 rounded-xl border bg-white/70 p-4 transition-all duration-200 hover:border-primary/40",
                    branch === b.code && "border-primary ring-[3px] ring-primary/10")}>
                    <input type="radio" name="branch" className="mt-1" checked={branch === b.code} onChange={() => storeActions.setBranch(b.code)} />
                    <span className="min-w-0 text-sm">
                      <span className="flex items-center gap-1 font-heading font-bold"><MapPin className="size-4 text-primary" />{b.name}</span>
                      <span className="block text-xs text-muted-foreground">{b.address}</span>
                      {ok ? <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-success-fg"><CheckCircle2 className="size-3.5" />Everything in your cart is in stock</span>
                        : <span className="mt-1 block text-xs font-semibold text-warning">{sh.length} item{sh.length === 1 ? "" : "s"} short: {sh.slice(0, 2).map((s) => `${s.name} (${s.available} left)`).join(", ")}{sh.length > 2 ? "…" : ""}</span>}
                    </span>
                  </label>
                );
              })}
            </div>
            {branch && branchShort.length > 0 && <p role="alert" className="text-sm text-warning">This branch cannot supply the full order yet — choose another branch or reduce quantities in your cart.</p>}
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
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Payment method">
              <label className="flex cursor-pointer gap-3 rounded-xl border border-primary bg-white/70 p-4 ring-[3px] ring-primary/10">
                <input type="radio" name="pay" checked readOnly className="mt-1" />
                <span className="text-sm"><span className="flex items-center gap-1 font-heading font-bold"><Banknote className="size-4 text-primary" />Pay at pick-up</span>
                  <span className="block text-xs text-muted-foreground">Pay at the branch counter when you collect — by cash, or by UPI / card through Razorpay.</span></span>
              </label>
              <label className="flex gap-3 rounded-xl border border-dashed bg-muted/50 p-4 opacity-70">
                <input type="radio" name="pay" disabled className="mt-1" />
                <span className="text-sm"><span className="flex items-center gap-1 font-heading font-bold"><CreditCard className="size-4" />Pay online with Razorpay <span className="rounded-full bg-primary/10 px-2 text-[0.65rem] font-bold uppercase text-primary">Coming soon</span></span>
                  <span className="block text-xs text-muted-foreground">UPI, cards and net banking — pay now and just collect.</span></span>
              </label>
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
              {problem.message}
              {problem.short && <ul className="mt-1 list-disc pl-4 text-xs">{problem.short.map((s) => <li key={s.product_id}>{s.name}: only {s.available} available</li>)}</ul>}
            </div>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={busy || !data.open || !branch || branchShort.length > 0} data-testid="place-order">
            {busy && <Loader2 className="animate-spin" data-icon="inline-start" />}Place order
          </Button>
          {!data.open && <p className="text-xs text-warning">The store is not taking orders right now.</p>}
          <p className="text-xs text-muted-foreground">Your order is held for {data.pickup_hold_days ?? 3} days. You will get an e-mail with your invoice straight away.</p>
        </aside>
      </div>
    </form>
  );
}
