"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { useAsync } from "@/hooks/use-async";
import { API_MODE } from "@/lib/services";
import { api } from "@/lib/services/api";
import { cn } from "@/lib/utils";

export interface StockAlert { product_id: string; name: string; branch_code: string; branch_name: string; remaining: number; status: "LOW" | "OUT" }
export interface StockAlerts { count: number; out: number; low: number; items: StockAlert[] }

/** Every low / out-of-stock material (all branches for the central admin, own branch otherwise). Reloads when `key` changes. */
export function useStockAlerts(enabled: boolean, key: string) {
  return useAsync(() => (API_MODE && enabled ? api<StockAlerts>("/stock/alerts") : Promise.resolve(null)), `stock-alerts:${enabled}:${key}`);
}

const when = (a: StockAlert) => (a.status === "OUT" ? "out of stock" : `${a.remaining} left`);

/** Small amber/red button at the top of every admin screen: how many materials are low, a quick list, and a way to the Stock page. */
export function LowStockButton({ routeKey }: { routeKey: string }) {
  const alerts = useStockAlerts(true, routeKey);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const a = alerts.data;
  if (!a || a.count === 0) return null;
  const critical = a.out > 0;
  return (
    <div ref={box} className="relative" data-testid="low-stock-alert">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title="Materials that are low or out of stock"
        className={cn("inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition-all duration-200 hover:-translate-y-0.5",
          critical ? "border-danger/30 bg-danger/10 text-danger" : "border-warning/30 bg-warning/10 text-warning")}
      >
        <AlertTriangle className="size-4" />
        <span>Low stock</span>
        <span className={cn("grid min-w-5 place-items-center rounded-full px-1.5 py-0.5 text-[0.65rem] text-white", critical ? "bg-danger" : "bg-warning")}>{a.count}</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-xl border bg-white shadow-card-hover">
          <div className="border-b px-4 py-3">
            <p className="font-heading text-sm font-bold">Stock needs attention</p>
            <p className="text-xs text-muted-foreground">{a.out} out of stock · {a.low} running low</p>
          </div>
          <ul className="max-h-72 divide-y overflow-y-auto text-sm">
            {a.items.slice(0, 8).map((i) => (
              <li key={`${i.product_id}-${i.branch_code}`} className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="min-w-0"><span className="block truncate font-medium">{i.name.replace(/\s+/g, " ")}</span><span className="text-xs text-muted-foreground">{i.branch_name}</span></span>
                <span className={cn("shrink-0 text-xs font-bold", i.status === "OUT" ? "text-danger" : "text-warning")}>{when(i)}</span>
              </li>
            ))}
          </ul>
          <Link href="/stock" onClick={() => setOpen(false)} className="flex items-center justify-between border-t bg-secondary px-4 py-3 text-sm font-semibold text-primary hover:bg-accent">
            Open the Stock page <ArrowRight className="size-4" />
          </Link>
        </div>
      )}
    </div>
  );
}

/** A small icon next to one product: low somewhere? Click goes to the Stock page. */
export function ProductStockFlag({ alerts }: { alerts: StockAlert[] }) {
  if (alerts.length === 0) return null;
  const out = alerts.some((a) => a.status === "OUT");
  const text = alerts.map((a) => `${a.branch_name}: ${when(a)}`).join(" · ");
  return (
    <Link href="/stock" title={`${out ? "Out of stock" : "Low stock"} — ${text}. Click to open the Stock page.`} aria-label={`Low stock: ${text}`}
      className={cn("ml-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 align-middle text-[0.65rem] font-bold transition-colors",
        out ? "border-danger/30 bg-danger/10 text-danger hover:bg-danger/15" : "border-warning/30 bg-warning/10 text-warning hover:bg-warning/15")}
      data-testid="product-stock-flag">
      <AlertTriangle className="size-3" />{out ? "Out" : "Low"} · {alerts.length} branch{alerts.length === 1 ? "" : "es"}
    </Link>
  );
}
