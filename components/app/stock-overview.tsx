"use client";

import { useMemo, useState } from "react";
import { ArrowRight, ArrowRightLeft, Loader2 } from "lucide-react";
import { ErrorState, LoadingRows } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAsync } from "@/hooks/use-async";
import { formatDateTime, formatNumber } from "@/lib/format";
import { api } from "@/lib/services/api";
import { cn } from "@/lib/utils";

type Status = "OK" | "LOW" | "OUT" | "UNSET";
interface Cell { opening_qty: number | null; low_threshold: number | null; sold: number; transferred_in: number; transferred_out: number; remaining: number | null; status: Status }
interface Row { product_id: string; name: string; total_remaining: number; branches: Record<string, Cell> }
interface Overview { branches: { code: string; name: string }[]; items: Row[] }
interface Transfer { id: string; created_at: string; product: string; from_branch: string; to_branch: string; quantity: number; note: string; by: string }
interface Draft { product_id: string; from: string; to: string }

const TONE: Record<Status, string> = {
  OK: "bg-emerald-50 text-emerald-900",
  LOW: "bg-amber-50 text-amber-900",
  OUT: "bg-red-50 text-red-800",
  UNSET: "bg-slate-50 text-slate-500",
};
const LEGEND: [Status, string][] = [["OK", "OK"], ["LOW", "Low"], ["OUT", "Out"], ["UNSET", "Not set"]];
const SELECT_CLS = "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** Surplus branch -> branch in need, for one material; null when nothing sensible can be suggested. */
function suggest(row: Row): Draft | null {
  const cells = Object.entries(row.branches);
  const needy = cells.filter(([, c]) => c.status === "LOW" || c.status === "OUT").sort((a, b) => (a[1].remaining ?? 0) - (b[1].remaining ?? 0))[0];
  const rich = cells.filter(([, c]) => c.status === "OK" && c.remaining !== null && c.low_threshold !== null && c.remaining > 2 * c.low_threshold)
    .sort((a, b) => (b[1].remaining ?? 0) - (a[1].remaining ?? 0))[0];
  return needy && rich ? { product_id: row.product_id, from: rich[0], to: needy[0] } : null;
}

/** Central admin only: every branch's stock side by side, with digital transfers between branches. */
export function StockOverview() {
  const data = useAsync(() => api<Overview>("/stock/overview"), "stock-overview");
  const history = useAsync(() => api<Transfer[]>("/stock/transfers?limit=15"), "stock-transfers");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [onlyAttention, setOnlyAttention] = useState(false);

  const rows = useMemo(() => {
    const all = data.data?.items ?? [];
    return onlyAttention ? all.filter((r) => Object.values(r.branches).some((c) => c.status === "LOW" || c.status === "OUT") && suggest(r)) : all;
  }, [data.data, onlyAttention]);

  if (data.error) return <ErrorState message={data.error.message} onRetry={data.reload} />;
  if (!data.data) return <LoadingRows rows={8} />;
  const { branches, items } = data.data;
  const movable = items.filter((r) => suggest(r)).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setDraft({ product_id: items[0]?.product_id ?? "", from: branches[0]?.code ?? "", to: branches[1]?.code ?? "" })}>
          <ArrowRightLeft data-icon="inline-start" /> Transfer stock
        </Button>
        <Button variant={onlyAttention ? "default" : "outline"} onClick={() => setOnlyAttention((v) => !v)} aria-pressed={onlyAttention}>
          Can be rebalanced ({movable})
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {LEGEND.map(([s, label]) => (
            <span key={s} className={cn("rounded-md border px-1.5 py-0.5", TONE[s])}>{label}</span>
          ))}
        </div>
      </div>
      {msg && <p role="status" className="text-sm">{msg}</p>}

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-secondary/60 text-left">
            <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
              <th className="sticky left-0 bg-secondary">Material</th>
              {branches.map((b) => <th key={b.code} className="text-right">{b.name}</th>)}
              <th className="text-right">All branches</th>
              <th className="w-px" />
            </tr>
          </thead>
          <tbody className="[&>tr]:border-t [&_td]:px-3 [&_td]:py-1.5">
            {rows.map((r) => {
              const hint = suggest(r);
              return (
                <tr key={r.product_id} data-testid="stock-matrix-row">
                  <td className="sticky left-0 bg-card font-medium">{r.name}</td>
                  {branches.map((b) => {
                    const c = r.branches[b.code];
                    return (
                      <td key={b.code} className={cn("text-right tabular-nums", TONE[c.status])}
                        title={`${b.name}: opening ${c.opening_qty ?? "not set"}, sold ${c.sold}, received ${c.transferred_in}, sent ${c.transferred_out}`}>
                        <span className="font-semibold">{c.remaining === null ? "—" : formatNumber(c.remaining)}</span>
                        {(c.transferred_in > 0 || c.transferred_out > 0) && (
                          <span className="ml-1 text-[10px] opacity-70">
                            {c.transferred_in > 0 && `+${c.transferred_in}`}{c.transferred_out > 0 && ` -${c.transferred_out}`}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="text-right font-semibold tabular-nums">{formatNumber(r.total_remaining)}</td>
                  <td className="whitespace-nowrap text-right">
                    <Button size="sm" variant={hint ? "default" : "ghost"} aria-label={`Transfer ${r.name}`}
                      title={hint ? `Suggested: ${hint.from} → ${hint.to}` : "Transfer"}
                      onClick={() => setDraft(hint ?? { product_id: r.product_id, from: branches[0].code, to: branches[1].code })}>
                      <ArrowRightLeft data-icon="inline-start" /> {hint ? `${hint.from} → ${hint.to}` : "Transfer"}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Each figure is what is left to sell after invoices, transfers sent and received (+ received, - sent). Hover a figure for the working.
      </p>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Recent transfers</h2>
        {history.data && history.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No transfers yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-secondary/60 text-left"><tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium"><th>When</th><th>Material</th><th>Move</th><th className="text-right">Qty</th><th>By</th><th>Note</th></tr></thead>
              <tbody className="[&>tr]:border-t [&_td]:px-3 [&_td]:py-1.5">
                {history.data?.map((t) => (
                  <tr key={t.id} data-testid="transfer-row">
                    <td className="whitespace-nowrap">{formatDateTime(t.created_at)}</td>
                    <td className="font-medium">{t.product}</td>
                    <td className="whitespace-nowrap">{t.from_branch} <ArrowRight className="inline size-3.5" /> {t.to_branch}</td>
                    <td className="text-right tabular-nums">{formatNumber(t.quantity)}</td>
                    <td>{t.by}</td>
                    <td className="text-muted-foreground">{t.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {draft && (
        <TransferDialog
          key={`${draft.product_id}-${draft.from}-${draft.to}`}
          overview={data.data}
          initial={draft}
          onClose={() => setDraft(null)}
          onDone={(text) => { setMsg(text); data.reload(); history.reload(); }}
        />
      )}
    </div>
  );
}

function TransferDialog({ overview, initial, onClose, onDone }: { overview: Overview; initial: Draft; onClose: () => void; onDone: (msg: string) => void }) {
  const [v, setV] = useState({ ...initial, qty: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const row = overview.items.find((r) => r.product_id === v.product_id);
  const from = row?.branches[v.from];
  const to = row?.branches[v.to];
  const qty = Number(v.qty);
  const available = from?.remaining ?? 0;
  const problem = v.from === v.to ? "Choose two different branches." : !(qty > 0) || !Number.isInteger(qty) ? null : qty > available ? `Only ${formatNumber(available)} available to send.` : null;
  const name = (code: string) => overview.branches.find((b) => b.code === code)?.name ?? code;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/stock/transfers", { method: "POST", body: JSON.stringify({ product_id: v.product_id, from_branch: v.from, to_branch: v.to, quantity: qty, note: v.note }) });
      onDone(`Moved ${formatNumber(qty)} × ${row?.name} from ${name(v.from)} to ${name(v.to)}.`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not transfer.");
      setBusy(false);
    }
  }

  const branchSelect = (id: string, key: "from" | "to") => (
    <select id={id} className={SELECT_CLS} value={v[key]} onChange={(e) => setV((x) => ({ ...x, [key]: e.target.value }))}>
      {overview.branches.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
    </select>
  );
  const level = (c: Cell | undefined) => (c ? (c.remaining === null ? "no stock set" : `${formatNumber(c.remaining)} in stock`) : "");

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Transfer stock</DialogTitle>
            <DialogDescription>Move units of one material from one branch to another. Both branches see the new figures straight away.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="t-product">Material</Label>
            <select id="t-product" className={SELECT_CLS} value={v.product_id} onChange={(e) => setV((x) => ({ ...x, product_id: e.target.value }))}>
              {overview.items.map((r) => <option key={r.product_id} value={r.product_id}>{r.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="t-from">From</Label>
              {branchSelect("t-from", "from")}
              <p className="text-xs text-muted-foreground">{level(from)}</p>
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label="Swap branches" onClick={() => setV((x) => ({ ...x, from: x.to, to: x.from }))}>
              <ArrowRightLeft />
            </Button>
            <div className="space-y-1.5">
              <Label htmlFor="t-to">To</Label>
              {branchSelect("t-to", "to")}
              <p className="text-xs text-muted-foreground">{level(to)}</p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-qty">Quantity</Label>
            <Input id="t-qty" type="number" min={1} max={Math.max(available, 1)} step={1} value={v.qty} onChange={(e) => setV((x) => ({ ...x, qty: e.target.value }))} />
            {qty > 0 && !problem && from?.remaining != null && (
              <p className="text-xs text-muted-foreground">
                {name(v.from)} will have {formatNumber(from.remaining - qty)} left; {name(v.to)} will have {formatNumber((to?.remaining ?? 0) + qty)}.
              </p>
            )}
            {problem && <p role="alert" className="text-xs text-destructive">{problem}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-note">Note (optional)</Label>
            <Input id="t-note" maxLength={300} value={v.note} onChange={(e) => setV((x) => ({ ...x, note: e.target.value }))} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={busy} />}>Cancel</DialogClose>
            <Button type="submit" disabled={busy || !(qty > 0) || !Number.isInteger(qty) || !!problem}>
              {busy && <Loader2 className="animate-spin" data-icon="inline-start" />}
              Transfer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
