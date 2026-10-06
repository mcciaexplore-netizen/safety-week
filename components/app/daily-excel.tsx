"use client";

import { useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { todayLocalIso } from "@/lib/invoice/model";
import { downloadFromApi } from "@/lib/services/api";

const BRANCHES: [code: string, name: string][] = [
  ["SBR", "SB Road"], ["TIL", "Tilak Road"], ["BHO", "Bhosari"], ["HAD", "Hadapsar"], ["AHL", "Ahilyanagar"],
];

/**
 * Bulk download of one day's invoices as a single Excel file (one tab per invoice).
 * Branch admin: their own branch. Central admin: all five branches combined, or each branch on its own.
 */
export function DailyExcel({ central, branch }: { central: boolean; branch?: string }) {
  const [day, setDay] = useState(todayLocalIso());
  const [busy, setBusy] = useState<string | null>(null);

  async function run(branch: string) {
    setBusy(branch);
    try {
      const q = new URLSearchParams({ date: day });
      if (central) q.set("branch", branch);
      await downloadFromApi(`/exports/daily-invoices?${q}`, `invoices-${branch}-${day}.xlsx`);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Could not download the Excel file."); // ponytail: no toast system yet
    } finally {
      setBusy(null);
    }
  }
  const Icon = (b: string) => (busy === b ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <FileSpreadsheet data-icon="inline-start" />);

  return (
    <section className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3" aria-label="Download the day's invoices" data-testid="daily-excel">
      <span className="text-sm font-medium">Download one day&apos;s invoices (Excel)</span>
      <Input type="date" value={day} max={todayLocalIso()} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Day to download" className="w-40" />
      {central && branch !== undefined ? (
        // the invoices page picks the branch with its own buttons: one download for what is selected ("" = all five combined)
        <Button onClick={() => run(branch || "ALL")} disabled={!!busy}>
          {Icon(branch || "ALL")}{branch ? `Download ${BRANCHES.find(([c]) => c === branch)?.[1]} Excel` : "Download all branches Excel"}
        </Button>
      ) : central ? (
        <>
          <Button onClick={() => run("ALL")} disabled={!!busy}>{Icon("ALL")}All 5 branches combined</Button>
          {BRANCHES.map(([code, name]) => (
            <Button key={code} variant="outline" onClick={() => run(code)} disabled={!!busy} aria-label={`Download ${name} invoices`}>
              {Icon(code)}{name}
            </Button>
          ))}
        </>
      ) : (
        <Button onClick={() => run("MINE")} disabled={!!busy}>{Icon("MINE")}Download Excel</Button>
      )}
    </section>
  );
}
