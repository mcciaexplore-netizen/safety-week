"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ErrorState, LoadingRows } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAsync } from "@/hooks/use-async";
import { formatMoney } from "@/lib/format";
import { api } from "@/lib/services/api";

interface Report {
  event: { name: string; year: number };
  totals: { invoices: number; value: string | number };
  by_branch: { code: string; name: string; invoices: number; value: string | number }[];
  by_month: { month: string; invoices: number; value: string | number }[];
  by_product: { name: string; quantity: number; value: string | number }[];
  by_status: { status: string; invoices: number; value: string | number }[];
  by_payment_mode: { mode: string; payments: number; value: string | number }[];
  outstanding: { invoices: number; value: string | number };
}

function Table({ title, head, rows }: { title: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <section className="rounded-xl glass shadow-card" aria-label={title}>
      <h2 className="border-b px-4 py-3 font-medium">{title}</h2>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="text-left text-muted-foreground"><tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:font-medium">{head.map((h, i) => <th key={h} className={i ? "text-right" : ""}>{h}</th>)}</tr></thead>
        <tbody className="[&>tr]:border-t [&_td]:px-4 [&_td]:py-2">
          {rows.length === 0 ? <tr><td colSpan={head.length} className="text-muted-foreground">No data for this period.</td></tr> : rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className={j ? "text-right tabular-nums" : ""}>{c}</td>)}</tr>
          ))}
        </tbody></table></div>
    </section>
  );
}

const MODE_LABEL: Record<string, string> = { CASH: "Cash", RAZORPAY: "Razorpay", UPI: "UPI", CARD: "Card", NET_BANKING: "Net banking", OTHER: "Other" };
const money = (v: string | number) => formatMoney(Number(v));
const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

export default function ReportsPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const rep = useAsync(() => {
    const p = new URLSearchParams();
    if (from) p.set("date_from", from);
    if (to) p.set("date_to", to);
    return api<Report>(`/admin/reports?${p}`);
  }, `admin-report:${from}:${to}`);

  function exportCsv(r: Report) {
    const lines = [["Section", "Name", "Invoices/Qty", "Value"],
      ...r.by_branch.map((b) => ["Branch", b.name, b.invoices, b.value]),
      ...r.by_month.map((m) => ["Month", m.month, m.invoices, m.value]),
      ...r.by_product.map((p) => ["Product", p.name, p.quantity, p.value]),
      ...r.by_status.map((s) => ["Status", s.status, s.invoices, s.value]),
      ...r.by_payment_mode.map((m) => ["Payment mode", m.mode, m.payments, m.value]),
      ["Outstanding", "Balance due", r.outstanding.invoices, r.outstanding.value]];
    const url = URL.createObjectURL(new Blob([lines.map((l) => l.map(csvCell).join(",")).join("\n")], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: `report-${r.event.year}.csv` }).click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader title="Reports" description="Sales across all branches. Counts submitted, PDF-generated and edited invoices; drafts and cancelled invoices are left out (except in the status table)."
        actions={rep.data && <Button variant="outline" onClick={() => exportCsv(rep.data!)}><Download data-icon="inline-start" />Download CSV</Button>} />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">From <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" className="w-40" /></label>
        <label className="flex items-center gap-2">To <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" className="w-40" /></label>
        {rep.data && <span className="font-medium" data-testid="report-total">{rep.data.totals.invoices} invoices · ₹{money(rep.data.totals.value)}</span>}
      </div>
      {rep.error ? <ErrorState message={rep.error.message} onRetry={rep.reload} /> : !rep.data ? <LoadingRows rows={6} /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Table title="By branch" head={["Branch", "Invoices", "Value (₹)"]} rows={rep.data.by_branch.map((b) => [b.name, b.invoices, money(b.value)])} />
          <Table title="By month" head={["Month", "Invoices", "Value (₹)"]} rows={rep.data.by_month.map((m) => [m.month, m.invoices, money(m.value)])} />
          <Table title="Top materials (before tax)" head={["Material", "Quantity", "Value (₹)"]} rows={rep.data.by_product.map((p) => [p.name.replace(/\s+/g, " "), p.quantity, money(p.value)])} />
          <Table title="Received by mode of payment" head={["Mode", "Payments", "Amount (₹)"]} rows={rep.data.by_payment_mode.map((m) => [MODE_LABEL[m.mode] ?? m.mode, m.payments, money(m.value)])} />
          <Table title="Outstanding (not fully paid)" head={["", "Invoices", "Balance due (₹)"]} rows={[["Sales invoices with a balance", rep.data.outstanding.invoices, money(rep.data.outstanding.value)]]} />
          <Table title="By status (all invoices)" head={["Status", "Invoices", "Value (₹)"]} rows={rep.data.by_status.map((s) => [s.status, s.invoices, money(s.value)])} />
        </div>
      )}
    </>
  );
}
