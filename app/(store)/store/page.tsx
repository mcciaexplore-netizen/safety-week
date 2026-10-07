"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CreditCard, MapPin, PackageCheck, ShoppingCart } from "lucide-react";
import { ErrorState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BranchSelect, PriceBlock, ProductImage, ProductLink, StockLine } from "@/components/store/bits";
import { storeActions, useCatalogue, useStore, type Product } from "@/lib/store/client";
import { cn } from "@/lib/utils";

const STEPS = [
  { icon: ShoppingCart, title: "1. Choose", text: "Browse and add what you need to the cart." },
  { icon: MapPin, title: "2. Pick a branch", text: "Choose which of our five MCCIA branches you will collect from — you see its stock live." },
  { icon: CreditCard, title: "3. Pay your way", text: "Pay online, or simply pay at the branch counter when you collect." },
  { icon: PackageCheck, title: "4. Collect", text: "We pack it and e-mail you. Show your invoice and take it home." },
];

function Shop() {
  const params = useSearchParams();
  const { data, error, reload } = useCatalogue();
  const { branch, cart } = useStore();
  const [category, setCategory] = useState<string>("All");
  const [sort, setSort] = useState<"name" | "low" | "high">("name");
  const [inStockOnly, setInStockOnly] = useState(false);
  const q = (params.get("q") ?? "").toLowerCase().trim();
  const branchName = data?.branches.find((b) => b.code === branch)?.name;

  const products = useMemo(() => {
    if (!data) return [];
    let list = data.products.filter((p) => (category === "All" || p.category === category) && (!q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)));
    if (inStockOnly && branch) list = list.filter((p) => (p.stock[branch] ?? 0) > 0);
    if (sort === "low") list = [...list].sort((a, b) => Number(a.price_incl_gst) - Number(b.price_incl_gst));
    if (sort === "high") list = [...list].sort((a, b) => Number(b.price_incl_gst) - Number(a.price_incl_gst));
    return list;
  }, [data, category, q, inStockOnly, branch, sort]);

  return (
    <>
      <section className="relative overflow-hidden border-b bg-brand-gradient text-white">
        <div className="pointer-events-none absolute -top-24 -right-24 size-96 rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.25),transparent_70%)]" />
        <div className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6 md:py-20">
          <p className="label-xs !text-white/70">National Safety Week {data?.year ?? 2027}</p>
          <h1 className="mt-3 max-w-2xl text-[clamp(2rem,5vw,3.6rem)] leading-[1.08] font-extrabold !text-white">Safety merchandise, ready for you to collect.</h1>
          <p className="mt-4 max-w-xl text-base text-white/80">Order online from MCCIA, pick it up from the branch that suits you, and pay online or at the counter. No delivery charges, no waiting for couriers.</p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <a href="#products"><Button size="lg" className="!bg-white !bg-none !text-primary">Shop now</Button></a>
            <Link href="/store/help" className="text-sm font-semibold text-white/90 underline-offset-4 hover:underline">How pick-up works</Link>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-8 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        {STEPS.map(({ icon: Icon, title, text }) => (
          <div key={title} className="glass rounded-xl p-5">
            <span className="icon-tile mb-3"><Icon className="size-[18px]" /></span>
            <p className="font-heading font-bold">{title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{text}</p>
          </div>
        ))}
      </section>

      <section id="products" className="mx-auto max-w-6xl scroll-mt-24 px-4 pb-16 sm:px-6">
        {data && !data.open && (
          <p role="status" className="mb-6 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">The store is not taking orders at the moment — please check back soon. You can still browse.</p>
        )}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-[clamp(1.6rem,3vw,2.2rem)] font-bold">{q ? `Results for “${params.get("q")}”` : "All products"}</h2>
            <p className="text-sm text-muted-foreground">{data ? `${products.length} product${products.length === 1 ? "" : "s"}` : "Loading…"}</p>
          </div>
          {data && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">Collect from
                <BranchSelect branches={data.branches} value={branch} onChange={storeActions.setBranch} />
              </label>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">Sort
                <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="h-9 rounded-lg border border-input bg-white px-3 text-sm">
                  <option value="name">Featured</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option>
                </select>
              </label>
              {branch && (
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} /> In stock at {branchName}
                </label>
              )}
            </div>
          )}
        </div>

        {data && (
          <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Categories">
            {["All", ...data.categories].map((c) => (
              <button key={c} type="button" onClick={() => setCategory(c)} aria-pressed={category === c}
                className={cn("rounded-full border px-4 py-1.5 text-sm font-medium transition-all duration-200",
                  category === c ? "border-primary bg-primary text-primary-foreground" : "bg-white text-muted-foreground hover:border-primary/40 hover:text-primary")}>
                {c}
              </button>
            ))}
          </div>
        )}

        {error ? <ErrorState title="The store could not be loaded" message={error} onRetry={reload} /> : !data ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-72" />)}</div>
        ) : products.length === 0 ? (
          <p className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">Nothing matches. Try another category or search.</p>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4" data-testid="product-grid">
            {products.map((p) => <ProductCard key={p.id} p={p} branch={branch} branchName={branchName} inCart={cart[p.id] ?? 0} />)}
          </ul>
        )}
      </section>
    </>
  );
}

function ProductCard({ p, branch, branchName, inCart }: { p: Product; branch: string | null; branchName?: string; inCart: number }) {
  const here = branch ? p.stock[branch] ?? 0 : null;
  const total = Object.values(p.stock).reduce((a, b) => a + b, 0);
  return (
    <li className="card-lift glass flex flex-col rounded-xl p-4" data-testid="product-card">
      <ProductLink product={p} className="block">
        <ProductImage product={p} />
        <p className="label-xs mt-4">{p.category}</p>
        <h3 className="mt-1 line-clamp-2 min-h-[2.5rem] font-heading text-base leading-snug font-bold">{p.name}</h3>
      </ProductLink>
      <PriceBlock product={p} className="mt-2" />
      <div className="mt-1 min-h-5">
        {here !== null ? <StockLine qty={here} branchName={branchName} /> : <span className="text-xs text-muted-foreground">{total > 0 ? "Choose a branch to see stock" : "Out of stock everywhere"}</span>}
      </div>
      <div className="mt-auto pt-4">
        <Button className="w-full" variant={inCart ? "outline" : "default"} disabled={total === 0} onClick={() => storeActions.add(p.id)} aria-label={`Add ${p.name} to cart`}>
          <ShoppingCart data-icon="inline-start" />{inCart ? `In cart (${inCart}) · add one more` : "Add to cart"}
        </Button>
      </div>
    </li>
  );
}

export default function StorePage() {
  return <Suspense fallback={null}><Shop /></Suspense>;
}
