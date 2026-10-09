"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Pencil, X } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { type EditRequest } from "@/components/app/request-edit";
import { EmptyState, ErrorState, LoadingRows } from "@/components/app/states";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAsync } from "@/hooks/use-async";
import { useSession } from "@/hooks/use-session";
import { formatDateTime } from "@/lib/format";
import { API_MODE } from "@/lib/services";
import { api } from "@/lib/services/api";

const FILTERS = [["OPEN", "Waiting"], ["DONE", "Done"], ["DECLINED", "Declined"], ["", "All"]] as const;

function StatusPill({ r }: { r: EditRequest }) {
  const cls = r.status === "OPEN" ? "bg-warning/10 text-warning" : r.status === "DONE" ? "bg-success/10 text-success-fg" : "bg-muted text-muted-foreground";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{r.status === "OPEN" ? "Waiting" : r.status === "DONE" ? "Done" : "Declined"}</span>;
}

/** The central admin answers edit requests here (change the invoice, or decline with a reason); branches see their own. */
export default function EditRequestsPage() {
  const { session } = useSession();
  const central = session?.user.role === "SUPER_ADMIN";
  const [status, setStatus] = useState<string>("OPEN");
  const list = useAsync(() => (API_MODE ? api<EditRequest[]>(`/edit-requests${status ? `?status=${status}` : ""}`) : Promise.resolve([] as EditRequest[])), `edit-requests:${status}`);
  const [declining, setDeclining] = useState<EditRequest | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decline() {
    if (!declining) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/edit-requests/${declining.id}/decline`, { method: "POST", body: JSON.stringify({ note: note.trim() }) });
      setDeclining(null);
      setNote("");
      list.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not decline the request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Edit requests"
        description={central
          ? "Branches ask here to change a submitted invoice. Open the invoice to make the change (the request is answered automatically), or decline it with a reason."
          : "Requests you have sent to the central admin to change a submitted invoice. Send a new one from the invoice page."}
      />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
        {FILTERS.map(([v, l]) => <Button key={v} variant={status === v ? "default" : "outline"} aria-pressed={status === v} onClick={() => setStatus(v)}>{l}</Button>)}
      </div>

      {list.error ? <ErrorState message={list.error.message} onRetry={list.reload} /> : !list.data ? <LoadingRows rows={5} /> : list.data.length === 0 ? (
        <EmptyState title={status === "OPEN" ? "No requests waiting" : "No requests here"} />
      ) : (
        <div className="overflow-x-auto rounded-xl glass shadow-card">
          <table className="w-full text-sm" data-testid="edit-requests">
            <thead className="bg-secondary/60 text-left"><tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium"><th>Invoice</th>{central && <th>Branch</th>}<th>Requested by</th><th>What needs to change</th><th>Status</th><th /></tr></thead>
            <tbody className="[&>tr]:border-t [&_td]:px-3 [&_td]:py-2 [&_td]:align-top">
              {list.data.map((r) => (
                <tr key={r.id} data-testid="edit-request-row">
                  <td>
                    <Link href={`/invoices/${r.invoice_id}`} className="font-mono font-medium text-primary hover:underline">{r.invoice_number}</Link>
                    <span className="block max-w-48 truncate text-xs text-muted-foreground">{r.company_name}</span>
                  </td>
                  {central && <td>{r.branch_name}</td>}
                  <td>{r.requested_by_name}<span className="block text-xs text-muted-foreground">{formatDateTime(r.created_at)}</span></td>
                  <td className="max-w-80 whitespace-pre-wrap">
                    {r.reason}
                    {r.status === "DECLINED" && <span className="mt-1 block text-xs text-muted-foreground">Declined by {r.resolved_by_name}: {r.resolved_note}</span>}
                    {r.status === "DONE" && <span className="mt-1 block text-xs text-muted-foreground">Changed by {r.resolved_by_name}{r.resolved_at ? ` · ${formatDateTime(r.resolved_at)}` : ""}</span>}
                  </td>
                  <td><StatusPill r={r} /></td>
                  <td>
                    {central && r.status === "OPEN" && (
                      <div className="flex justify-end gap-1.5">
                        <Link href={`/invoices/${r.invoice_id}/edit`} className={buttonVariants({ size: "sm" })} data-testid="open-to-edit"><Pencil data-icon="inline-start" />Edit invoice</Link>
                        <Button size="sm" variant="outline" onClick={() => { setDeclining(r); setNote(""); setError(null); }}><X data-icon="inline-start" />Decline</Button>
                      </div>
                    )}
                    {r.status === "DONE" && <Check className="ml-auto size-4 text-success-fg" aria-hidden />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!declining} onOpenChange={(o) => !o && setDeclining(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline the request for {declining?.invoice_number}?</DialogTitle>
            <DialogDescription>The invoice stays as it is. Your reason is shown to the branch.</DialogDescription>
          </DialogHeader>
          <Textarea aria-label="Reason for declining" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. the invoice is correct as issued" maxLength={1000} />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Back</DialogClose>
            <Button variant="destructive" disabled={busy || note.trim().length < 3} onClick={decline} data-testid="confirm-decline">Decline request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
