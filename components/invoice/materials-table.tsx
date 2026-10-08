"use client";

import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { formatMoney, formatNumber } from "@/lib/format";
import type { InvoiceView } from "@/lib/invoice/model";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Section } from "./invoice-form";

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The order form: every material in the catalogue as a row, with a Qty. box to type into.
 * Same behaviour as the old on-sheet cells (typing a quantity adds the material; clearing it removes it),
 * but laid out like the other form sections. Amounts come from the same `InvoiceView` as the preview.
 */
export function MaterialsTable({
  products,
  view,
  error,
  canEditRate,
  onQty,
  onRate,
  limits,
}: {
  products: Product[];
  view: InvoiceView;
  error?: string;
  canEditRate: boolean;
  onQty: (productId: string, qty: number) => void;
  onRate: (productId: string, rate: number) => void;
  /** How many of each material the branch can still sell (absent = stock not set up, so no limit). */
  limits?: Record<string, number | null>;
}) {
  const lines = useMemo(() => new Map(view.lines.filter((l) => l.productId).map((l) => [l.productId, l])), [view.lines]);
  const t = view.totals;
  const chosen = view.lines.filter((l) => l.quantity > 0).length;
  const disc = view.discountPercent > 0;

  return (
    <Section title="Materials" hint="Type a quantity against each material you need; amounts fill in automatically. Leave the rest empty.">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-base" data-testid="materials-table">
          <thead className="bg-secondary/60 text-left">
            <tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:font-medium">
              <th className="w-12">Sr.</th>
              <th>Material</th>
              <th>HSN</th>
              <th className="text-right">Rate (₹)</th>
              {disc && <th className="text-right">After discount</th>}
              {limits && <th className="text-right">In stock</th>}
              <th className="w-28 text-center">Qty.</th>
              <th className="text-right">GST</th>
              <th className="text-right">Amount (₹)</th>
            </tr>
          </thead>
          <tbody className="[&>tr]:border-t [&_td]:px-4 [&_td]:py-2">
            {products.map((p, idx) => {
              const l = lines.get(p.id);
              const qty = l?.quantity ?? 0;
              const name = clean(p.name);
              const limit = limits ? (limits[p.id] ?? null) : null;
              const over = limit !== null && qty > limit;
              return (
                <tr key={p.id} data-testid="material-row" className={cn(qty > 0 && !over && "bg-success/10", over && "bg-danger/10")}>
                  <td className="text-muted-foreground tabular-nums">{idx + 1}</td>
                  <td className="font-medium">{name}</td>
                  <td className="font-mono text-sm text-muted-foreground">{p.hsnCode}</td>
                  <td className="text-right tabular-nums">
                    {canEditRate && qty > 0 ? (
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={l!.rate}
                        aria-label={`Rate for ${name}`}
                        onChange={(e) => onRate(p.id, Math.max(0, Number(e.target.value) || 0))}
                        className="ml-auto w-28 border-warning/50 bg-warning/10 text-right"
                      />
                    ) : (
                      formatMoney(l?.rate ?? p.currentRate)
                    )}
                  </td>
                  {disc && <td className="text-right tabular-nums text-muted-foreground">{l ? formatMoney(l.rateAfterDiscount) : "—"}</td>}
                  {limits && (
                    <td className={cn("text-right tabular-nums", over ? "font-semibold text-danger" : limit === 0 ? "text-danger" : "text-muted-foreground")} data-testid="stock-left">
                      {limit === null ? "—" : limit}
                    </td>
                  )}
                  <td className="text-center">
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={qty || ""}
                      placeholder="0"
                      aria-label={`Quantity for ${name}`}
                      data-testid="qty-input"
                      onChange={(e) => onQty(p.id, Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                      className={cn("mx-auto w-24 text-center tabular-nums", qty > 0 && "border-success/50 font-semibold", over && "border-danger bg-danger/10 font-semibold text-danger ring-[3px] ring-danger/20")}
                      aria-invalid={over || undefined}
                    />
                    {over && <p role="alert" className="mt-1 text-xs font-semibold text-danger">Only {limit} in stock</p>}
                  </td>
                  <td className="text-right tabular-nums text-muted-foreground">{p.gstHalfRate * 2}%</td>
                  <td className={cn("text-right tabular-nums", qty > 0 ? "font-medium" : "text-muted-foreground")}>
                    {l && qty > 0 ? formatMoney(l.totalAmount) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t bg-secondary/60 font-medium">
            <tr className="[&>td]:px-4 [&>td]:py-3">
              <td />
              <td>{chosen} material{chosen === 1 ? "" : "s"} selected</td>
              <td />
              <td />
              {disc && <td />}
              {limits && <td />}
              <td className="text-center tabular-nums" data-testid="total-qty">{formatNumber(t.totalQuantity)}</td>
              <td />
              <td className="text-right tabular-nums">{formatMoney(t.grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {error && (
        <p role="alert" data-testid="error-items" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </Section>
  );
}
