"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import { DailyExcel } from "@/components/app/daily-excel";
import { DownloadButton } from "@/components/app/download-button";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ErrorState, LoadingRows } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAsync } from "@/hooks/use-async";
import { formatDateTime, formatInvoiceDate, formatRupees } from "@/lib/format";
import { api } from "@/lib/services/api";
import type { InvoiceStatus } from "@/lib/types";

interface Row { id: string; invoice_number: string; company_name: string; invoice_date: string; grand_total: string; status: InvoiceStatus; created_by_name: string; updated_at: string; version: number }
const BRANCHES = [["", "All branches"], ["SBR", "SB Road"], ["TIL", "Tilak Road"], ["BHO", "Bhosari"], ["HAD", "Hadapsar"], ["AHL", "Ahilyanagar"]];
const STATUSES = ["", "DRAFT", "SUBMITTED", "GENERATED", "EDITED", "CANCELLED"];
const SEL = "h-8 rounded-lg border border-input bg-background px-2.5 text-sm";

export default function AdminInvoices() {
  const [q, setQ] = useState("");
  const [branch, setBranch] = useState("");
  const [status, setStatus] = useState("");
  const list = useAsync(() => {
    const p = new URLSearchParams({ limit: "500" });
    if (q.trim()) p.set("q", q.trim());
    if (branch) p.set("branch", branch);
    if (status) p.set("status", status);
    return api<Row[]>(`/invoices?${p}`);
  }, `admin-inv:${q}:${branch}:${status}`);

  return (
    <>
      <PageHeader title="Invoices" description="Every invoice from all branches. Open one to see its versions, cancel it, or download the PDF." />
      <DailyExcel central />
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search invoice ID or company…" aria-label="Search invoices" className="flex-1" />
        <select className={SEL} aria-label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)}>{BRANCHES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select className={SEL} aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{s || "All statuses"}</option>)}</select>
      </div>
      {list.error ? <ErrorState message={list.error.message} onRetry={list.reload} /> : !list.data ? <LoadingRows rows={8} /> : list.data.length === 0 ? <EmptyState title="No invoices match" /> : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left"><tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium"><th>Invoice ID</th><th>Date</th><th>Company</th><th className="text-right">Total</th><th>Status</th><th>Created by</th><th>Updated</th><th /></tr></thead>
            <tbody className="[&>tr]:border-t [&_td]:px-3 [&_td]:py-2">
              {list.data.map((i) => (
                <tr key={i.id}>
                  <td className="font-mono font-medium">{i.invoice_number}</td><td>{formatInvoiceDate(`${i.invoice_date}T00:00:00Z`)}</td><td className="max-w-56 truncate">{i.company_name}</td>
                  <td className="text-right tabular-nums">{formatRupees(Number(i.grand_total))}</td><td><StatusBadge status={i.status} /></td><td>{i.created_by_name}</td><td className="text-muted-foreground">{formatDateTime(i.updated_at)}</td>
                  <td><div className="flex justify-end gap-1.5">
                    <Link href={`/invoices/${i.id}`} className={buttonVariants({ variant: "outline", size: "icon-sm" })} aria-label={`View ${i.invoice_number}`}><Eye /></Link>
                    <DownloadButton invoice={{ id: i.id, invoiceNumber: i.invoice_number }} disabled={i.status === "DRAFT" || i.status === "CANCELLED"} />
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">{list.data.length} invoice(s)</p>
        </div>
      )}
    </>
  );
}
