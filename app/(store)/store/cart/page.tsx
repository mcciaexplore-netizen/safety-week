"use client";

import Link from "next/link";
import { ShoppingBag, Trash2 } from "lucide-react";
import { ErrorState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BranchSelect, ProductImage, QtyStepper } from "@/components/store/bits";
import { cartLines, cartTotals, gstPrice, rupees, storeActions, useCatalogue, useStore } from "@/lib/store/client";

export default function CartPage() {
  const { data, error, reload } = useCatalogue();
  const { cart, branch, ready } = useStore();
  if (error) return <div className="mx-auto max-w-3xl px-4 py-16"><ErrorState message={error} onRetry={reload} /></div>;
  if (!data || !ready) return <div className="mx-auto max-w-5xl px-4 py-12"><Skeleton className="h-64" /></div>;
  const lines = cartLines(data, cart);
  const t = cartTotals(lines);

  if (lines.length === 0)
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <span className="icon-tile mx-auto mb-4"><ShoppingBag className="size-[18px]" /></span>
        <h1 className="text-3xl">Your cart is empty</h1>
        <p className="mt-2 text-muted-foreground">Add some safety materials and they will appear here.</p>
        <Link href="/store" className="mt-6 inline-block"><Button size="lg">Browse products</Button></Link>
      </div>
    );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="mb-6 text-[clamp(1.8rem,3.5vw,2.5rem)] font-extrabold">Your cart</h1>
      <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
        <ul className="space-y-3" data-testid="cart-lines">
          {lines.map(({ product: p, qty }) => (
            <li key={p.id} className="glass flex gap-4 rounded-xl p-4" data-testid="cart-line">
              <div className="w-20 shrink-0"><ProductImage product={p} /></div>
              <div className="min-w-0 flex-1">
                <Link href={`/store/p/${p.slug}`} className="font-heading font-bold hover:text-primary">{p.name}</Link>
                <p className="text-sm">{rupees(p.rate)} <span className="text-xs text-muted-foreground">({rupees(gstPrice(p))} incl. GST)</span></p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <QtyStepper value={qty} onChange={(n) => storeActions.setQty(p.id, n)} label={`Quantity of ${p.name}`} />
                  <button type="button" onClick={() => storeActions.setQty(p.id, 0)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-danger" aria-label={`Remove ${p.name}`}>
                    <Trash2 className="size-3.5" />Remove
                  </button>
                </div>
              </div>
              <p className="shrink-0 text-right font-heading font-bold">{rupees(gstPrice(p) * qty)}</p>
            </li>
          ))}
        </ul>

        <aside className="glass h-fit space-y-4 rounded-xl p-5 lg:sticky lg:top-24">
          <h2 className="text-lg">Order summary</h2>
          <dl className="space-y-2 text-sm tabular-nums">
            <div className="flex justify-between"><dt className="text-muted-foreground">Items ({t.count})</dt><dd>{rupees(t.basic)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">GST</dt><dd>{rupees(t.gst)}</dd></div>
            <div className="flex justify-between border-t pt-2 text-base font-semibold"><dt>Total (rounded)</dt><dd data-testid="cart-total">{rupees(t.total)}</dd></div>
          </dl>
          <p className="text-xs text-muted-foreground">No delivery charge — you collect from a branch.</p>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Collect from</span>
            <BranchSelect id="cart-branch" branches={data.branches} value={branch} onChange={storeActions.setBranch} className="w-full" />
          </label>
          <Link href="/store/checkout" className="block"><Button size="lg" className="w-full">Continue to checkout</Button></Link>
          <Link href="/store" className="block text-center text-sm font-semibold text-primary">Keep shopping</Link>
        </aside>
      </div>
    </div>
  );
}
