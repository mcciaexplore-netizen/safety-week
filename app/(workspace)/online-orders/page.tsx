"use client";

import { useState } from "react";
import { CheckCheck, PackageCheck, XCircle } from "lucide-react";
import { EditDialog, str } from "@/components/admin/edit-dialog";
import { PageHeader } from "@/components/app/page-header";
import { PickupDialog } from "@/components/app/pickup-dialog";
import { EmptyState, ErrorState, LoadingRows } from "@/components/app/states";
import { OrderStatusPill } from "@/components/store/bits";
import { Button } from "@/components/ui/button";
import { useAsync } from "@/hooks/use-async";
import { useSession } from "@/hooks/use-session";
import { formatDateTime, formatRupees } from "@/lib/format";
import { API_MODE } from "@/lib/services";
import { api } from "@/lib/services/api";
import type { Order } from "@/lib/store/client";

type Row = Order & { id: string };
const TABS: [string, string][] = [["OPEN", "To prepare / hand over"], ["PENDING_PAYMENT", "Awaiting payment"], ["READY", "Ready for pick-up"], ["PICKED_UP", "Collected"], ["CANCELLED", "Cancelled"], ["EXPIRED", "Released"]];
const BRANCHES: [string, string][] = [["", "All branches"], ["SBR", "SB Road"], ["TIL", "Tilak Road"], ["BHO", "Bhosari"], ["HAD", "Hadapsar"], ["AHL", "Ahilyanagar"]];
const SEL = "h-9 rounded-lg border border-input bg-white px-3 text-sm";

export default function OnlineOrdersPage() {
  const { session } = useSession();
  const role = session?.user.role;
  const [tab, setTab] = useState("OPEN");
  const [branch, setBranch] = useState("");
  const [dialog, setDialog] = useState<{ kind: "pickup" | "cancel"; order: Row } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const list = useAsync(() => {
    if (!API_MODE || !session) return Promise.resolve(null);
    const q = new URLSearchParams({ status: tab });
    if (branch && role === "SUPER_ADMIN") q.set("branch", branch);
    return api<Row[]>(`/store-orders?${q}`);
  }, `online-orders:${session?.user.id}:${tab}:${branch}`);

  if (!API_MODE) return <EmptyState title="Available with the live backend" description="Online orders are kept on the server." />;
  const isAdmin = role === "SUPER_ADMIN" || role === "BRANCH_ADMIN";

  async function act(o: Row, what: "ready") {
    setBusy(o.id); setErr(null);
    try { await api(`/store-orders/${o.id}/${what}`, { method: "POST" }); list.reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not update the order."); }
    finally { setBusy(null); }
  }


  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Online orders" description="Orders placed on the MCCIA Store for collection from a branch. Pack them, mark them ready (the customer is e-mailed), and when they collect, record the payment."
        actions={role === "SUPER_ADMIN" ? (
          <select aria-label="Branch" className={SEL} value={branch} onChange={(e) => setBranch(e.target.value)}>{BRANCHES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        ) : undefined} />
      <div role="tablist" aria-label="Order status" className="flex flex-wrap gap-2">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-all duration-200 ${tab === k ? "border-primary bg-primary text-primary-foreground" : "bg-white text-muted-foreground hover:border-primary/40 hover:text-primary"}`}>{label}</button>
        ))}
      </div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      {list.error ? <ErrorState message={list.error.message} onRetry={list.reload} /> : !list.data ? <LoadingRows rows={5} /> : list.data.length === 0 ? <EmptyState title="Nothing here" description="New online orders appear here as soon as they are placed." /> : (
        <div className="overflow-x-auto rounded-xl glass shadow-card">
          <table className="w-full text-sm">
            <thead className="text-left"><tr className="[&>th]:px-4 [&>th]:py-3"><th>Order</th><th>Customer</th><th>Items</th><th className="text-right">Total</th><th>Payment</th><th>Status</th><th /></tr></thead>
            <tbody className="[&>tr]:border-t [&_td]:px-4 [&_td]:py-3 [&_td]:align-top">
              {list.data.map((o) => (
                <tr key={o.id} data-testid="online-order-row">
                  <td><span className="block font-mono font-semibold">{o.number}</span><span className="text-xs text-muted-foreground">{formatDateTime(o.created_at)}</span>{role === "SUPER_ADMIN" && <span className="block text-xs text-muted-foreground">Collect: {o.branch.name}</span>}</td>
                  <td><span className="block font-medium">{o.customer.name}</span><span className="block text-xs text-muted-foreground">{o.customer.phone}</span><span className="block text-xs text-muted-foreground">{o.customer.email}</span></td>
                  <td className="max-w-64"><ul className="space-y-0.5 text-xs">{o.items.map((i) => <li key={i.name}>{i.quantity} × {i.name}</li>)}</ul>{o.note && <p className="mt-1 text-xs italic text-muted-foreground">“{o.note}”</p>}</td>
                  <td className="text-right tabular-nums">{formatRupees(Number(o.total))}</td>
                  <td>{o.payment_status === "PAID" ? <span className="text-xs font-semibold text-success-fg">{o.payment_method === "ONLINE" ? "Paid online" : "Paid"}</span> : o.payment_status === "REFUNDED" ? <span className="text-xs font-semibold text-muted-foreground">Refunded</span> : o.payment_method === "ONLINE" ? <span className="text-xs font-semibold text-warning">Awaiting online payment</span> : <span className="text-xs font-semibold text-warning">Pay at pick-up</span>}</td>
                  <td><OrderStatusPill status={o.status} /></td>
                  <td>
                    {(o.status === "PLACED" || o.status === "READY" || o.status === "PENDING_PAYMENT") && (
                      <div className="flex flex-wrap justify-end gap-2">
                        {o.status === "PLACED" && <Button size="sm" variant="outline" disabled={busy === o.id} onClick={() => act(o, "ready")}><PackageCheck data-icon="inline-start" />Mark ready</Button>}
                        {o.status !== "PENDING_PAYMENT" && <Button size="sm" onClick={() => setDialog({ kind: "pickup", order: o })}><CheckCheck data-icon="inline-start" />Collected</Button>}
                        {isAdmin && <Button size="sm" variant="destructive" onClick={() => setDialog({ kind: "cancel", order: o })}><XCircle data-icon="inline-start" />Cancel</Button>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog?.kind === "pickup" && <PickupDialog key={dialog.order.id} order={dialog.order} onClose={() => setDialog(null)} onDone={() => list.reload()} />}
      {dialog?.kind === "cancel" && (
        <EditDialog key={`c-${dialog.order.id}`} title={`Cancel ${dialog.order.number}`} description={dialog.order.payment_status === "PAID" ? `The customer paid ${formatRupees(Number(dialog.order.total))} online: the FULL amount is refunded through Razorpay, the items go back into stock and the customer is e-mailed.` : "The items go back into stock and the customer is e-mailed."}
          fields={[{ key: "reason", label: "Reason", wide: true }]} initial={{ reason: "" }} submitLabel={dialog.order.payment_status === "PAID" ? "Cancel and refund" : "Cancel order"}
          onSave={async (v) => { await api(`/store-orders/${dialog.order.id}/cancel`, { method: "POST", body: JSON.stringify({ reason: str(v.reason) }) }); list.reload(); }}
          onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
