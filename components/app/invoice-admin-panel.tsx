"use client";

import { useState } from "react";
import { Ban, Eye } from "lucide-react";
import { DownloadButton } from "@/components/app/download-button";
import { ErrorState, LoadingRows } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { InvoicePaper, PaperFrame } from "@/components/invoice/invoice-paper";
import { Button } from "@/components/ui/button";
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
import { formatDateTime, formatRupees } from "@/lib/format";
import { invoiceToView } from "@/lib/invoice/model";
import { services } from "@/lib/services";
import type { Invoice } from "@/lib/types";

/** Admin-only: every version of the invoice (who, when, why), view any of them, cancel the invoice. */
export function InvoiceAdminPanel({ invoice, onChanged }: { invoice: Invoice; onChanged: () => void }) {
  const versions = useAsync(() => services.admin.listVersions(invoice.id), `versions:${invoice.id}:${invoice.version}:${invoice.status}`);
  const [viewing, setViewing] = useState<number | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const old = useAsync(
    async () => (viewing ? { inv: await services.admin.getVersion(invoice.id, viewing), products: await services.catalog.listProducts() } : null),
    `version:${invoice.id}:${viewing}`,
  );

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await services.admin.cancelInvoice(invoice.id, reason.trim());
      setCancelOpen(false);
      setReason("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel the invoice.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border bg-card p-5 print:hidden" aria-label="Admin: version history">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Version history</h2>
          <p className="text-xs text-muted-foreground">
            Every change keeps the earlier version on record. Visible to admins only.
          </p>
        </div>
        {invoice.status !== "CANCELLED" && (
          <Button variant="destructive" onClick={() => setCancelOpen(true)}>
            <Ban data-icon="inline-start" />
            Cancel invoice
          </Button>
        )}
      </div>

      {versions.error ? (
        <ErrorState message={versions.error.message} onRetry={versions.reload} />
      ) : !versions.data ? (
        <LoadingRows rows={2} />
      ) : versions.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No versions yet — a draft is not versioned until it is submitted.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr className="[&>th]:px-2 [&>th]:py-1.5 [&>th]:font-medium">
                <th>Version</th>
                <th>When</th>
                <th>By</th>
                <th>Reason</th>
                <th>Status</th>
                <th className="text-right">Total</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="[&>tr]:border-t [&_td]:px-2 [&_td]:py-2">
              {versions.data.map((v) => (
                <tr key={v.versionNumber} data-testid="version-row">
                  <td className="font-mono font-medium">v{v.versionNumber}</td>
                  <td className="whitespace-nowrap">{formatDateTime(v.createdAt)}</td>
                  <td>{v.editedBy}</td>
                  <td className="max-w-64 truncate" title={v.editReason}>{v.editReason || "—"}</td>
                  <td><StatusBadge status={v.status} /></td>
                  <td className="text-right tabular-nums">{formatRupees(v.grandTotal)}</td>
                  <td>
                    <div className="flex justify-end gap-1.5">
                      <Button variant="outline" size="icon-sm" aria-label={`View version ${v.versionNumber}`}
                        onClick={() => setViewing(v.versionNumber)}>
                        <Eye />
                      </Button>
                      {v.status !== "CANCELLED" && (
                        <DownloadButton invoice={invoice} version={v.versionNumber} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={viewing !== null} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Version {viewing} — as it was then</DialogTitle>
            <DialogDescription>Read-only copy from the saved record of that version.</DialogDescription>
          </DialogHeader>
          {old.error ? (
            <ErrorState message={old.error.message} />
          ) : old.data ? (
            <div className="rounded-md bg-neutral-200 p-2">
              <PaperFrame>
                <InvoicePaper view={invoiceToView(old.data.inv)} products={old.data.products} />
              </PaperFrame>
            </div>
          ) : (
            <LoadingRows rows={4} />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {invoice.invoiceNumber}?</DialogTitle>
            <DialogDescription>
              The invoice stays on record but becomes read-only, and no new PDF can be made for it. The reason is
              saved with the cancellation.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="Reason for cancellation"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. duplicate order"
            maxLength={500}
          />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Keep invoice</DialogClose>
            <Button variant="destructive" disabled={busy || reason.trim().length < 3} onClick={cancel}>
              Cancel invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
