"use client";

import { useState } from "react";
import { Loader2, Save } from "lucide-react";
import { StockOverview } from "@/components/app/stock-overview";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ErrorState, LoadingRows } from "@/components/app/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAsync } from "@/hooks/use-async";
import { useSession } from "@/hooks/use-session";
import { formatNumber } from "@/lib/format";
import { API_MODE } from "@/lib/services";
import { api } from "@/lib/services/api";
import { cn } from "@/lib/utils";

interface Item { product_id: string; name: string; opening_qty: number | null; low_threshold: number | null; sold: number; transferred_in: number; transferred_out: number; remaining: number | null; status: "OK" | "LOW" | "OUT" | "UNSET" }
interface Stock { branch_code: string; branch_name: string; items: Item[] }
const BRANCHES = [["SBR", "SB Road"], ["TIL", "Tilak Road"], ["BHO", "Bhosari"], ["HAD", "Hadapsar"], ["AHL", "Ahilyanagar"]];
const BADGE: Record<Item["status"], { text: string; cls: string }> = {
  OK: { text: "OK", cls: "border-success/20 bg-success/10 text-success-fg" },
  LOW: { text: "Low", cls: "border-warning/20 bg-warning/10 text-warning" },
  OUT: { text: "Out", cls: "border-danger/20 bg-danger/10 text-danger" },
  UNSET: { text: "Not set", cls: "border-border bg-muted text-muted-foreground" },
};

export default function StockPage() {
  const { session } = useSession();
  const [mode, setMode] = useState<"all" | "edit">("all");
  if (!API_MODE) return <EmptyState title="Available with the live backend" description="Stock is tracked on the server." />;
  // the central admin sees every branch at once (and can transfer stock); everyone else sees their own branch
  if (session?.user.role !== "SUPER_ADMIN") return <BranchStock />;
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Stock"
        description="Every branch's remaining stock side by side, so surplus in one branch can be moved to another that is running out."
        actions={
          <div role="tablist" aria-label="Stock view" className="inline-flex rounded-lg border bg-background p-0.5 text-sm">
            {([["all", "All branches"], ["edit", "Set opening stock"]] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
                className={cn("rounded-md px-3 py-1", mode === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                {label}
              </button>
            ))}
          </div>
        }
      />
      {mode === "all" ? <StockOverview /> : <BranchStock embedded />}
    </div>
  );
}

/** The page header, or just its action buttons when the page already has a header (central admin's edit tab). */
function Header({ embedded, ...props }: { embedded: boolean; title: string; description: string; actions: React.ReactNode }) {
  return embedded ? <div className="flex flex-wrap items-center gap-2">{props.actions}</div> : <PageHeader {...props} />;
}

function BranchStock({ embedded = false }: { embedded?: boolean }) {
  const { session } = useSession();
  const role = session?.user.role;
  const canEdit = role === "SUPER_ADMIN" || role === "BRANCH_ADMIN";
  const [branch, setBranch] = useState("TIL");
  const query = role === "SUPER_ADMIN" ? `?branch=${branch}` : "";
  const data = useAsync(() => (API_MODE && session ? api<Stock>(`/stock${query}`) : Promise.resolve(null)), `stock:${session?.user.id}:${branch}`);
  // edits are kept per material until Save; an untouched row keeps what the server has
  const [edits, setEdits] = useState<Record<string, { opening?: string; low?: string }>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const val = (i: Item, k: "opening" | "low") => edits[i.product_id]?.[k] ?? String((k === "opening" ? i.opening_qty : i.low_threshold) ?? (k === "low" ? "10" : ""));
  const dirty = Object.keys(edits).length > 0;

  async function save() {
    if (!data.data) return;
    setBusy(true);
    setMsg(null);
    try {
      const items = data.data.items
        .filter((i) => val(i, "opening").trim() !== "")
        .map((i) => ({ product_id: i.product_id, opening_qty: Number(val(i, "opening")), low_threshold: Number(val(i, "low") || 10) }));
      await api(`/stock${query}`, { method: "PUT", body: JSON.stringify({ items }) });
      setEdits({});
      data.reload();
      setMsg("Stock saved.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("space-y-6", !embedded && "mx-auto max-w-5xl")}>
      <Header embedded={embedded}
        title="Stock"
        description="Enter the opening stock of each material. Remaining stock is worked out automatically from the invoices (drafts and cancelled invoices do not count)."
        actions={
          <>
            {role === "SUPER_ADMIN" && (
              <select aria-label="Branch" className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm" value={branch}
                onChange={(e) => { setBranch(e.target.value); setEdits({}); }}>
                {BRANCHES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
              </select>
            )}
            {canEdit && (
              <Button onClick={save} disabled={!dirty || busy}>
                {busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Save data-icon="inline-start" />}
                Save stock
              </Button>
            )}
          </>
        }
      />
      {msg && <p role="status" className="text-sm">{msg}</p>}
      {!canEdit && <p className="text-sm text-muted-foreground">You can view stock here; a branch admin sets it.</p>}
      {data.error ? <ErrorState message={data.error.message} onRetry={data.reload} /> : !data.data ? <LoadingRows rows={8} /> : (
        <div className="overflow-x-auto rounded-xl glass shadow-card">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left"><tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium"><th>Material</th><th className="text-right">Opening stock</th><th className="text-right">Sold</th><th className="text-right">Moved (in / out)</th><th className="text-right">Remaining</th><th className="text-right">Low when at or below</th><th>Status</th></tr></thead>
            <tbody className="[&>tr]:border-t [&_td]:px-3 [&_td]:py-1.5">
              {data.data.items.map((i) => {
                const opening = val(i, "opening");
                const remaining = opening.trim() === "" ? null : Number(opening) + i.transferred_in - i.transferred_out - i.sold;
                const live = remaining === null ? "UNSET" : remaining <= 0 ? "OUT" : remaining <= Number(val(i, "low") || 0) ? "LOW" : "OK";
                return (
                  <tr key={i.product_id} data-testid="stock-row">
                    <td className="font-medium">{i.name}</td>
                    <td className="text-right">
                      {canEdit ? (
                        <Input type="number" min={0} className="ml-auto h-7 w-24 text-right" aria-label={`Opening stock for ${i.name}`} value={opening}
                          onChange={(e) => setEdits((x) => ({ ...x, [i.product_id]: { ...x[i.product_id], opening: e.target.value } }))} />
                      ) : i.opening_qty ?? "—"}
                    </td>
                    <td className="text-right tabular-nums">{formatNumber(i.sold)}</td>
                    <td className="text-right tabular-nums text-muted-foreground">{i.transferred_in || i.transferred_out ? `+${i.transferred_in} / -${i.transferred_out}` : "—"}</td>
                    <td className={cn("text-right font-medium tabular-nums", live === "OUT" && "text-danger")}>{remaining === null ? "—" : formatNumber(remaining)}</td>
                    <td className="text-right">
                      {canEdit ? (
                        <Input type="number" min={0} className="ml-auto h-7 w-20 text-right" aria-label={`Low level for ${i.name}`} value={val(i, "low")}
                          onChange={(e) => setEdits((x) => ({ ...x, [i.product_id]: { ...x[i.product_id], low: e.target.value } }))} />
                      ) : i.low_threshold ?? "—"}
                    </td>
                    <td><Badge variant="outline" className={BADGE[live].cls}>{BADGE[live].text}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
