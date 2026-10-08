"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ShoppingCart } from "lucide-react";
import { ErrorState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BestSellerTag, BranchSelect, PriceBlock, ProductImage, QtyStepper, StockNote } from "@/components/store/bits";
import { AvailabilityNotice, ChooseBranchFirst } from "@/components/store/availability";
import { setQtyChecked, storeActions, useCatalogue, useStore, type Availability } from "@/lib/store/client";

export default function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { data, error, reload } = useCatalogue();
  const { branch, cart } = useStore();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [info, setInfo] = useState<Availability | null>(null);
  const [needBranch, setNeedBranch] = useState(false);
  const [busy, setBusy] = useState(false);
  const p = data?.products.find((x) => x.slug === slug);

  /** Live stock for the chosen branch decides how many can be added. */
  async function addToCart(code: string | null, quantity: number) {
    if (!p) return;
    if (!code) { setNeedBranch(true); return; }
    setNeedBranch(false);
    setBusy(true);
    try {
      const r = await setQtyChecked(p.id, (cart[p.id] ?? 0) + quantity, code);
      setInfo(r.info);
      if (r.qty > 0) { setAdded(true); setTimeout(() => setAdded(false), 2000); }
    } catch { setInfo(null); } finally { setBusy(false); }
  }

  if (error) return <div className="mx-auto max-w-3xl px-4 py-16"><ErrorState message={error} onRetry={reload} /></div>;
  if (!data) return <div className="mx-auto max-w-5xl px-4 py-12"><Skeleton className="h-96" /></div>;
  if (!p) return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-3xl">We could not find that product</h1>
      <Link href="/store" className="mt-4 inline-block font-semibold text-primary">Back to the store</Link>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <Link href="/store" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"><ArrowLeft className="size-4" />All products</Link>
      <div className="grid gap-10 md:grid-cols-2">
        <div className="glass relative rounded-xl p-4"><ProductImage product={p} />{p.best_seller && <BestSellerTag className="absolute top-7 left-7" />}</div>
        <div>
          <p className="label-xs">{p.category}</p>
          <h1 className="mt-2 text-[clamp(1.8rem,3.5vw,2.5rem)] font-extrabold">{p.name}</h1>
          <PriceBlock product={p} size="lg" className="mt-4" />
          <p className="mt-1 text-xs text-muted-foreground">Price per {p.unit.toLowerCase()} · HSN {p.hsn_code} · GST {Number(p.gst_percent)}%</p>

          <div className="mt-6 space-y-3 rounded-xl border bg-white/60 p-4">
            <label className="flex flex-wrap items-center gap-2 text-sm">Collect from
              <BranchSelect branches={data.branches} value={branch} onChange={storeActions.setBranch} />
            </label>
            <StockNote product={p} branch={branch} />
            {needBranch && <ChooseBranchFirst branches={data.branches} onPick={(c) => { storeActions.setBranch(c); void addToCart(c, qty); }} />}
            {info && <AvailabilityNotice info={info} branchName={data.branches.find((b) => b.code === branch)?.name ?? ""} onSwitch={(c) => { storeActions.setBranch(c); setInfo(null); void addToCart(c, Math.max(1, info.wanted - (cart[p.id] ?? 0))); }} />}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <QtyStepper value={qty} onChange={(n) => setQty(Math.max(1, n))} label="Quantity" />
              <Button size="lg" disabled={busy} onClick={() => void addToCart(branch, qty)}>
                {added ? <Check data-icon="inline-start" /> : <ShoppingCart data-icon="inline-start" />}{added ? "Added" : "Add to cart"}
              </Button>
              {(cart[p.id] ?? 0) > 0 && <Link href="/store/cart" className="text-sm font-semibold text-primary">View cart ({cart[p.id]})</Link>}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
