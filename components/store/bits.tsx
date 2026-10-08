"use client";

import Link from "next/link";
import { BookOpen, Flag, Gift, Image as ImageIcon, Minus, Plus, ScrollText, Shield, Shirt } from "lucide-react";
import { gstPrice, rupees, type Branch, type OrderStatus, type Product } from "@/lib/store/client";
import { cn } from "@/lib/utils";

const CATEGORY_ICON: Record<string, typeof Shield> = {
  "T-Shirts": Shirt, Flags: Flag, Banners: ImageIcon, "Posters & Slogans": ImageIcon, "Scrolls & Oath": ScrollText,
  "Books & Calendars": BookOpen, "Gifts & Accessories": Gift,
};

/** The product photo, or (until MCCIA uploads one) a tidy tile with the category icon. */
export function ProductImage({ product, className }: { product: Pick<Product, "name" | "category" | "image_url">; className?: string }) {
  const Icon = CATEGORY_ICON[product.category] ?? Shield;
  if (product.image_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={product.image_url} alt={product.name} loading="lazy" className={cn("aspect-square w-full rounded-xl object-cover", className)} />;
  }
  return (
    <div
      role="img"
      aria-label={product.name}
      className={cn("flex aspect-square w-full items-center justify-center rounded-xl bg-[radial-gradient(circle_at_30%_20%,rgba(0,63,138,0.10),transparent_60%),radial-gradient(circle_at_80%_90%,rgba(16,185,129,0.12),transparent_55%)] bg-secondary", className)}
    >
      <Icon className="size-1/4 text-primary/60" strokeWidth={1.5} />
    </div>
  );
}

/** Price as asked: the shelf price first, the GST-inclusive price in small brackets underneath. */
export function PriceBlock({ product, size = "md", className }: { product: Product; size?: "md" | "lg"; className?: string }) {
  return (
    <div className={className}>
      <p className={cn("font-heading font-extrabold tracking-tight text-foreground", size === "lg" ? "text-4xl" : "text-xl")}>{rupees(product.rate)}</p>
      <p className={cn("text-muted-foreground", size === "lg" ? "text-sm" : "text-xs")}>({rupees(gstPrice(product))} incl. GST)</p>
    </div>
  );
}

/** Availability at the shopper's chosen branch. */
export function StockLine({ qty, branchName }: { qty: number; branchName?: string }) {
  if (qty <= 0)
    return <span className="text-xs font-semibold text-danger">Out of stock{branchName ? ` at ${branchName}` : ""}</span>;
  if (qty <= 5) return <span className="text-xs font-semibold text-warning">Only {qty} left{branchName ? ` at ${branchName}` : ""}</span>;
  return <span className="text-xs font-semibold text-success-fg">In stock{branchName ? ` at ${branchName}` : ""}</span>;
}

export function QtyStepper({ value, onChange, max = 500, label }: { value: number; onChange: (n: number) => void; max?: number; label: string }) {
  return (
    <div className="inline-flex items-center rounded-lg border bg-white" role="group" aria-label={label}>
      <button type="button" aria-label={`Decrease ${label}`} className="grid size-9 place-items-center text-muted-foreground hover:text-primary disabled:opacity-40"
        onClick={() => onChange(value - 1)} disabled={value <= 0}><Minus className="size-4" /></button>
      <input
        aria-label={label}
        inputMode="numeric"
        className="h-9 w-12 border-x bg-transparent text-center text-sm font-semibold outline-none"
        value={value}
        onChange={(e) => onChange(Math.max(0, Math.min(max, Math.floor(Number(e.target.value.replace(/\D/g, "")) || 0))))}
      />
      <button type="button" aria-label={`Increase ${label}`} className="grid size-9 place-items-center text-muted-foreground hover:text-primary disabled:opacity-40"
        onClick={() => onChange(value + 1)} disabled={value >= max}><Plus className="size-4" /></button>
    </div>
  );
}

const STATUS: Record<OrderStatus, { label: string; cls: string }> = {
  PLACED: { label: "Order placed", cls: "border-primary/20 bg-primary/10 text-primary" },
  READY: { label: "Ready for pick-up", cls: "border-success/30 bg-success/10 text-success-fg" },
  PICKED_UP: { label: "Collected", cls: "border-border bg-muted text-muted-foreground" },
  CANCELLED: { label: "Cancelled", cls: "border-danger/20 bg-danger/10 text-danger" },
  EXPIRED: { label: "Released (not collected)", cls: "border-warning/30 bg-warning/10 text-warning" },
};
export function OrderStatusPill({ status }: { status: OrderStatus }) {
  const s = STATUS[status];
  return <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-[0.68rem] font-bold uppercase tracking-[0.08em]", s.cls)}>{s.label}</span>;
}

export function BranchSelect({ branches, value, onChange, className, id }: { branches: Branch[]; value: string | null; onChange: (code: string) => void; className?: string; id?: string }) {
  return (
    <select
      id={id}
      aria-label="Pick-up branch"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className={cn("h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/10", className)}
    >
      <option value="" disabled>Choose pick-up branch</option>
      {branches.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
    </select>
  );
}

export function ProductLink({ product, children, className }: { product: Product; children: React.ReactNode; className?: string }) {
  return <Link href={`/store/p/${product.slug}`} className={className}>{children}</Link>;
}

/** Stock at every branch on one line each, so the shopper can compare and pick where to collect from. Click a branch to choose it. */
export function BranchStockChips({ stock, branches, selected, onPick }: { stock: Record<string, number>; branches: Branch[]; selected: string | null; onPick: (code: string) => void }) {
  return (
    <ul className="mt-1 grid grid-cols-2 gap-1" aria-label="Stock at each branch" data-testid="stock-chips">
      {branches.map((b) => {
        const n = stock[b.code] ?? 0;
        return (
          <li key={b.code}>
            <button type="button" onClick={() => onPick(b.code)} aria-pressed={selected === b.code} title={`${b.name}: ${n > 0 ? `${n} in stock` : "out of stock"} - click to collect from here`}
              className={cn("flex w-full items-center justify-between gap-1 rounded-md border px-2 py-1 text-left text-[0.7rem] leading-tight transition-colors duration-200 hover:border-primary/50",
                selected === b.code ? "border-primary bg-primary/5" : "bg-white/70")}>
              <span className="truncate font-medium">{b.name}</span>
              <span className={cn("shrink-0 font-bold tabular-nums", n === 0 ? "text-danger" : n <= 5 ? "text-warning" : "text-success-fg")}>{n}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
