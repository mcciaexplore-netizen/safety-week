"use client";

import { useState } from "react";
import { FileArchive, FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { todayLocalIso } from "@/lib/invoice/model";
import { downloadFromApi } from "@/lib/services/api";

const BRANCHES: [code: string, name: string][] = [
  ["SBR", "SB Road"], ["TIL", "Tilak Road"], ["BHO", "Bhosari"], ["HAD", "Hadapsar"], ["AHL", "Ahilyanagar"],
];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

/**
 * Bulk download of the invoices issued between two dates: one Excel workbook (a tab per invoice) or a ZIP of PDFs.
 * Branch admin: their own branch. Central admin: the branch selected above the box, or all five combined.
 */
export function DailyExcel({ central, branch }: { central: boolean; branch?: string }) {
  const today = todayLocalIso();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState<string | null>(null);
  const scope = central ? (branch || "ALL") : "MINE";
  const scopeName = !central ? "" : branch ? BRANCHES.find(([c]) => c === branch)?.[1] : "";

  async function run(kind: "xlsx" | "zip") {
    setBusy(kind);
    try {
      const q = new URLSearchParams({ date_from: from, date_to: to });
      if (central) q.set("branch", scope);
      const stamp = from === to ? from : `${from}_to_${to}`;
      if (kind === "xlsx") await downloadFromApi(`/exports/daily-invoices?${q}`, `invoices-${scope}-${stamp}.xlsx`);
      else await downloadFromApi(`/exports/invoice-pdfs?${q}`, `invoice-pdfs-${scope}-${stamp}.zip`);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Could not download the invoices."); // ponytail: no toast system yet
    } finally {
      setBusy(null);
    }
  }
  const range = (a: string, b: string) => { setFrom(a); setTo(b); };
  const bad = !from || !to || to < from;
  const excelLabel = central ? (branch ? `Download ${scopeName} Excel` : "Download all branches Excel") : "Download Excel";

  return (
    <section className="space-y-3 rounded-xl glass shadow-card p-4" aria-label="Download invoices for a date range" data-testid="daily-excel">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm font-medium">Download invoices by date</span>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">From
          <Input type="date" value={from} max={today} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="From date" className="w-40" />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">To
          <Input type="date" value={to} max={today} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="To date" className="w-40" />
        </label>
        <span className="flex flex-wrap gap-1.5" role="group" aria-label="Quick ranges">
          {([["Today", today, today], ["Last 7 days", daysAgo(6), today], ["Last 30 days", daysAgo(29), today]] as const).map(([label, a, b]) => (
            <button key={label} type="button" onClick={() => range(a, b)}
              className="rounded-full border bg-white px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary">{label}</button>
          ))}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => run("xlsx")} disabled={!!busy || bad}>
          {busy === "xlsx" ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <FileSpreadsheet data-icon="inline-start" />}{excelLabel}
        </Button>
        <Button variant="outline" onClick={() => run("zip")} disabled={!!busy || bad} aria-label="Download PDFs as a ZIP">
          {busy === "zip" ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <FileArchive data-icon="inline-start" />}Download PDFs (ZIP)
        </Button>
        <span className="text-xs text-muted-foreground">Issued invoices only (no drafts or cancelled). Excel has one tab per invoice; the ZIP holds the PDFs, up to 60 at a time.</span>
      </div>
    </section>
  );
}
