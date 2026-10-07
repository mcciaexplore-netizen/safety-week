"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, ShoppingCart, UserRound } from "lucide-react";
import { MCCIALogo } from "@/components/brand/logo";
import { API_MODE } from "@/lib/services";
import { storeActions, useCatalogue, useStore } from "@/lib/store/client";
import { BranchSelect } from "./bits";

export function StoreShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { cart, branch, customer, ready } = useStore();
  const { data } = useCatalogue();
  const [q, setQ] = useState("");
  const count = Object.values(cart).reduce((a, b) => a + b, 0);

  function search(e: FormEvent) {
    e.preventDefault();
    router.push(q.trim() ? `/store?q=${encodeURIComponent(q.trim())}` : "/store");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/store" className="flex items-center gap-3" aria-label="MCCIA Store home">
            <MCCIALogo height={28} />
            <span className="border-l pl-3 font-heading text-lg font-bold tracking-tight">Store</span>
          </Link>
          <form onSubmit={search} role="search" className="order-last flex min-w-0 basis-full items-center gap-2 sm:order-none sm:flex-1 sm:basis-auto">
            <div className="relative w-full max-w-xl">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                aria-label="Search products"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search badges, caps, T-shirts, banners…"
                className="h-10 w-full rounded-xl border border-input bg-white pr-3 pl-9 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/10"
              />
            </div>
          </form>
          <nav className="ml-auto flex items-center gap-2" aria-label="Store">
            {data && (
              <label className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
                Pick-up
                <BranchSelect branches={data.branches} value={branch} onChange={storeActions.setBranch} />
              </label>
            )}
            <Link href="/store/account" className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-primary">
              <UserRound className="size-4" />
              <span className="hidden sm:inline">{ready && customer ? (customer.name || customer.email.split("@")[0]) : "Sign in"}</span>
            </Link>
            <Link href="/store/cart" aria-label={`Cart, ${count} item${count === 1 ? "" : "s"}`}
              className="relative inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-primary">
              <ShoppingCart className="size-5" />
              <span className="hidden sm:inline">Cart</span>
              {ready && count > 0 && (
                <span data-testid="cart-count" className="absolute -top-0.5 -right-0.5 grid min-w-5 place-items-center rounded-full bg-brand-gradient px-1 text-[0.65rem] font-bold text-white">{count}</span>
              )}
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {API_MODE ? children : (
          <div className="mx-auto max-w-xl px-4 py-24 text-center">
            <h1 className="text-3xl">The store needs the live server</h1>
            <p className="mt-3 text-muted-foreground">Set NEXT_PUBLIC_API_URL to use the online store.</p>
          </div>
        )}
      </main>

      <footer className="bg-ink-dark text-white/70">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-3 sm:px-6">
          <div>
            <p className="font-heading text-lg font-bold text-white">MCCIA Store</p>
            <p className="mt-2 text-white/60">Safety-awareness materials from the Mahratta Chamber of Commerce, Industries and Agriculture.</p>
          </div>
          <div>
            <p className="label-xs !text-white/50">Shop</p>
            <ul className="mt-3 space-y-2">
              <li><Link className="hover:text-white" href="/store">All products</Link></li>
              <li><Link className="hover:text-white" href="/store/cart">Your cart</Link></li>
              <li><Link className="hover:text-white" href="/store/account">Your orders</Link></li>
            </ul>
          </div>
          <div>
            <p className="label-xs !text-white/50">Help</p>
            <ul className="mt-3 space-y-2">
              <li><Link className="hover:text-white" href="/store/help">How pick-up works</Link></li>
              <li><Link className="hover:text-white" href="/store/help#payment">Payment options</Link></li>
              <li><Link className="hover:text-white" href="/store/help#privacy">Privacy &amp; contact</Link></li>
            </ul>
          </div>
        </div>
        <p className="border-t border-white/10 px-4 py-4 text-center text-xs text-white/50">© Mahratta Chamber of Commerce, Industries and Agriculture · MCCIA Trade Tower, Senapati Bapat Road, Pune</p>
      </footer>
    </div>
  );
}
