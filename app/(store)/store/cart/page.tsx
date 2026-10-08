"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShoppingBag, Trash2 } from "lucide-react";
import { ErrorState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BranchSelect, ProductImage, QtyStepper } from "@/components/store/bits";
import { useEffect, useState } from "react";
import { AvailabilityNotice, ChooseBranchFirst } from "@/components/store/availability";
import { cartLines, cartTotals, checkAvailability, gstPrice, rupees, setQtyChecked, storeActions, useCatalogue, useStore, type Availability } from "@/lib/store/client";

export default function CartPage() {
  const { data, error, reload } = useCatalogue();
  const router = useRouter();
  const { cart, branch, ready } = useStore();
  const [notes, setNotes] = useState<Record<string, Availability>>({});
  const [needBranch, setNeedBranch] = useState(false);
  const cartKey = JSON.stringify(cart);

  // whenever the branch or the cart changes, read the branch's LIVE stock and flag lines it cannot fully supply
  useEffect(() => {
    const items = Object.entries(JSON.parse(cartKey) as Record<string, number>).map(([product_id, quantity]) => ({ product_id, quantity }));
    if (!branch || items.length === 0) return;
    let live = true;
    checkAvailability(branch, items).then(
      (rows) => { if (live) setNotes(Object.fromEntries(rows.filter((r) => r.available < r.wanted).map((r) => [r.product_id, r]))); },
      () => {},
    );
    return () => { live = false; };
  }, [branch, cartKey]);

  /** Changing a quantity re-reads the live stock; the branch's real number is the limit. */
  async function change(id: string, n: number, current: number) {
    if (n <= current) { storeActions.setQty(id, n); setNotes((x) => { const { [id]: _drop, ...rest } = x; void _drop; return rest; }); return; }
    if (!branch) { setNeedBranch(true); return; }
    setNeedBranch(false);
    try {
      const r = await setQtyChecked(id, n, branch);
      setNotes((x) => { const { [id]: _drop, ...rest } = x; void _drop; return r.info ? { ...rest, [id]: r.info } : rest; });
    } catch { /* offline: leave the cart as it is */ }
  }
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
        <div>
        {needBranch && <ChooseBranchFirst className="mb-3" branches={data.branches} onPick={(c) => { storeActions.setBranch(c); setNeedBranch(false); }} />}
        <ul className="space-y-3" data-testid="cart-lines">
          {lines.map(({ product: p, qty }) => (
            <li key={p.id} className="glass flex flex-col gap-3 rounded-xl p-4" data-testid="cart-line">
              <div className="flex gap-4">
              <div className="w-20 shrink-0"><ProductImage product={p} /></div>
              <div className="min-w-0 flex-1">
                <Link href={`/store/p/${p.slug}`} className="font-heading font-bold hover:text-primary">{p.name}</Link>
                <p className="text-sm">{rupees(p.rate)} <span className="text-xs text-muted-foreground">({rupees(gstPrice(p))} incl. GST)</span></p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <QtyStepper value={qty} onChange={(n) => void change(p.id, n, qty)} label={`Quantity of ${p.name}`} />
                  <button type="button" onClick={() => storeActions.setQty(p.id, 0)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-danger" aria-label={`Remove ${p.name}`}>
                    <Trash2 className="size-3.5" />Remove
                  </button>
                </div>
              </div>
              <p className="shrink-0 text-right font-heading font-bold">{rupees(gstPrice(p) * qty)}</p>
              </div>
              {notes[p.id] && (
                <div>
                  <AvailabilityNotice info={notes[p.id]} adjusted={qty <= notes[p.id].available} branchName={data.branches.find((b) => b.code === branch)?.name ?? ""}
                    onSwitch={(c) => { storeActions.setBranch(c); setNotes({}); }} />
                </div>
              )}
            </li>
          ))}
        </ul>
        </div>

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
          <Button size="lg" className="w-full" onClick={() => (branch ? router.push("/store/checkout") : setNeedBranch(true))}>Continue to checkout</Button>
          {!branch && needBranch && <p role="alert" className="text-xs font-semibold text-danger">Choose the branch you will collect from first.</p>}
          <Link href="/store" className="block text-center text-sm font-semibold text-primary">Keep shopping</Link>
        </aside>
      </div>
    </div>
  );
}
