import type { DashboardSummary, Invoice, InvoiceStatus } from "@/lib/types";

const STATUSES: InvoiceStatus[] = ["DRAFT", "SUBMITTED", "GENERATED", "EDITED", "CANCELLED"];

/** Dashboard figures from a branch's invoices. Shared by the mock and the API-backed services. */
export function summarize(all: Invoice[]): DashboardSummary {
  const list = all.filter((i) => i.status !== "CANCELLED");
  const byProduct = new Map<string, { quantity: number; value: number }>();
  const byMonth = new Map<string, number>();
  for (const inv of list) {
    for (const it of inv.items) {
      const cur = byProduct.get(it.particulars) ?? { quantity: 0, value: 0 };
      cur.quantity += it.quantity;
      cur.value += it.basicAmount;
      byProduct.set(it.particulars, cur);
    }
    const label = new Date(inv.invoiceDate).toLocaleString("en-GB", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    });
    byMonth.set(label, (byMonth.get(label) ?? 0) + inv.totals.roundedTotal);
  }
  const totalValue = list.reduce((a, i) => a + i.totals.roundedTotal, 0);
  return {
    invoiceCount: list.length,
    draftCount: all.filter((i) => i.status === "DRAFT").length,
    submittedCount: all.filter((i) => i.status === "SUBMITTED").length,
    totalValue,
    averageValue: list.length ? totalValue / list.length : 0,
    unitsSold: list.reduce((a, i) => a + i.totals.totalQuantity, 0),
    statusBreakdown: STATUSES.map((status) => ({
      status,
      count: all.filter((i) => i.status === status).length,
    })),
    topProducts: [...byProduct.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5),
    monthly: [...byMonth.entries()].map(([label, value]) => ({ label, value })),
    recent: [...all].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5),
  };
}
