"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Eye, Loader2, Printer, RotateCcw, Save, Send } from "lucide-react";
import { DownloadButton } from "@/components/app/download-button";
import { StatusBadge } from "@/components/app/status-badge";
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
import { useAsync } from "@/hooks/use-async";
import { useSession } from "@/hooks/use-session";
import { formatDateTime, formatRupees } from "@/lib/format";
import { computeView, invoiceToDraft, itemFromProduct, withSyncedPayment, type InvoiceDraft } from "@/lib/invoice/model";
import { validateDraft, ValidationError, type ValidationMode } from "@/lib/invoice/validation";
import { API_MODE, services } from "@/lib/services";
import { api } from "@/lib/services/api";
import type { Invoice, Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { InvoiceForm } from "./invoice-form";
import { InvoicePaper, PaperFrame } from "./invoice-paper";
import { MaterialsTable } from "./materials-table";

export function InvoiceWorkspace({
  initialDraft,
  products,
}: {
  initialDraft: InvoiceDraft;
  products: Product[];
}) {
  // ONE typed state object. The form edits it; the preview is derived from it.
  const { session } = useSession();
  const canEditRate = session?.user.role !== "BRANCH_USER";
  const [draft, setDraft] = useState<InvoiceDraft>(initialDraft);
  // Last saved (or initial) version: drives "unsaved changes" and Reset.
  const [saved, setSaved] = useState<InvoiceDraft>(initialDraft);

  const [attempted, setAttempted] = useState<ValidationMode | null>(null);
  const [saving, setSaving] = useState<"draft" | "submit" | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Invoice | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  // The proforma preview: opened by the floating button ("view"), or by Submit as the final check ("submit").
  const [preview, setPreview] = useState<"view" | "submit" | null>(null);

  // stock the branch can still sell (live server only): a quantity above it turns red and cannot be submitted
  const stockNow = useAsync(
    () => (API_MODE && session ? api<{ items: { product_id: string; remaining: number | null }[] }>("/stock") : Promise.resolve(null)),
    `stock-limits:${session?.user.id}`,
  );
  const limits = useMemo(() => {
    if (!stockNow.data) return undefined;
    // an invoice that is already counted (submitted / edited) keeps its own quantities available for revision
    const own = new Map(saved.status && saved.status !== "DRAFT" && saved.status !== "CANCELLED" ? saved.items.map((i) => [i.productId ?? "", i.quantity]) : []);
    const out: Record<string, number | null> = {};
    for (const i of stockNow.data.items) out[i.product_id] = i.remaining === null ? null : Math.max(0, i.remaining + (own.get(i.product_id) ?? 0));
    return out;
  }, [stockNow.data, saved]);
  const overStock = useMemo(
    () => (limits ? draft.items.filter((i) => i.quantity > 0 && i.productId && limits[i.productId] != null && i.quantity > (limits[i.productId] as number)) : []),
    [draft.items, limits],
  );

  const view = useMemo(() => computeView(draft), [draft]);
  const errors = useMemo(() => (attempted ? validateDraft(draft, attempted) : {}), [draft, attempted]);
  const errorCount = Object.keys(errors).length;
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);

  const draftLike = draft.status === null || draft.status === "DRAFT";
  const cancelled = draft.status === "CANCELLED";

  function update(updater: (d: InvoiceDraft) => InvoiceDraft) {
    setDraft((d) => withSyncedPayment(updater(d))); // keeps a single payment equal to the payable amount
    setNotice(null);
  }

  /** Typing a quantity into the sheet adds/updates/removes that material; the catalogue order is kept. */
  const order = useMemo(() => new Map(products.map((p) => [p.id, p.lineOrder])), [products]);
  function setQty(productId: string, quantity: number) {
    update((d) => {
      if (quantity <= 0) return { ...d, items: d.items.filter((i) => i.productId !== productId) };
      if (d.items.some((i) => i.productId === productId))
        return { ...d, items: d.items.map((i) => (i.productId === productId ? { ...i, quantity } : i)) };
      const product = products.find((p) => p.id === productId);
      if (!product) return d;
      const items = [...d.items, { ...itemFromProduct(product), quantity }];
      return { ...d, items: items.sort((a, b) => (order.get(a.productId ?? "") ?? 0) - (order.get(b.productId ?? "") ?? 0)) };
    });
  }
  const setRate = (productId: string, rate: number) =>
    update((d) => ({ ...d, items: d.items.map((i) => (i.productId === productId ? { ...i, rate } : i)) }));

  async function save(action: "draft" | "submit") {
    setServerError(null);
    setNotice(null);
    const mode: ValidationMode = action === "submit" ? "submit" : "draft";
    setAttempted(mode);
    if (Object.keys(validateDraft(draft, mode)).length > 0) {
      return;
    }
    setSaving(action);
    try {
      const inv = await services.invoices.save({ draft, action });
      const next = invoiceToDraft(inv);
      setDraft(next);
      setSaved(next);
      setAttempted(null);
      if (!draft.id) window.history.replaceState(null, "", `/invoices/${inv.id}/edit`);
      if (action === "submit") setSubmitted(inv);
      else setNotice(`Draft saved at ${formatDateTime(inv.updatedAt)}`);
    } catch (e) {
      if (e instanceof ValidationError) setAttempted(mode);
      setServerError(e instanceof Error ? e.message : "Could not save the invoice.");
    } finally {
      setSaving(null);
      setPreview(null);
    }
  }

  /** Submit first shows the exact proforma; the invoice is only saved once the user confirms it. */
  function requestSubmit() {
    setServerError(null);
    setNotice(null);
    if (overStock.length > 0) {
      setServerError(`Some quantities are more than the stock available (${overStock.map((i) => i.particulars.replace(/\s+/g, " ")).join(", ")}). Reduce them to continue.`);
      return;
    }
    setAttempted("submit");
    if (Object.keys(validateDraft(draft, "submit")).length > 0) return;
    setPreview("submit");
  }

  function reset() {
    setDraft(saved);
    setAttempted(null);
    setServerError(null);
    setNotice("Changes discarded");
    setResetOpen(false);
  }

  const title = draft.id ? "Edit Proforma Invoice" : "New Proforma Invoice";
  const submitLabel = draftLike ? "Submit" : "Save revision";

  return (
    <div className="mx-auto max-w-[1600px]">
      {/* Action bar */}
      <div className="sticky top-14 z-20 -mx-4 mb-4 border-b bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
              {draft.status && <StatusBadge status={draft.status} />}
              {draft.id && <span className="text-xs text-muted-foreground">v{draft.version}</span>}
            </div>
            <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
              <span className="font-mono">{draft.invoiceNumber}</span>
              <span data-testid="save-state" className={cn(dirty && "text-warning")}>
                {saving
                  ? "Saving…"
                  : dirty
                    ? "Unsaved changes"
                    : (notice ?? (draft.id ? "All changes saved" : "Not saved yet"))}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setResetOpen(true)}
              disabled={!dirty || !!saving || cancelled}
            >
              <RotateCcw data-icon="inline-start" />
              Reset
            </Button>
            <Button type="button" variant="outline" onClick={() => setPreview("view")}>
              <Eye data-icon="inline-start" />
              Preview
            </Button>
            {draftLike && (
              <Button
                type="button"
                variant="outline"
                onClick={() => save("draft")}
                disabled={!!saving || cancelled}
              >
                {saving === "draft" ? (
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                ) : (
                  <Save data-icon="inline-start" />
                )}
                Save Draft
              </Button>
            )}
            <Button type="button" onClick={requestSubmit} disabled={!!saving || cancelled || overStock.length > 0} title={overStock.length > 0 ? "Some quantities are more than the stock available" : undefined}>
              {saving === "submit" ? (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              ) : (
                <Send data-icon="inline-start" />
              )}
              {submitLabel}
            </Button>
          </div>
        </div>
        {(serverError || (attempted && errorCount > 0)) && (
          <p role="alert" data-testid="form-error" className="mt-2 text-sm text-destructive">
            {serverError ?? `Please fix the ${errorCount} highlighted field${errorCount === 1 ? "" : "s"}.`}
          </p>
        )}
        {cancelled && (
          <p className="mt-2 text-sm text-muted-foreground">Cancelled invoices are read-only.</p>
        )}
      </div>

      {/* One column, top to bottom: customer, materials, invoice information, then the summary. The proforma itself is the preview. */}
      <div className="space-y-6 pb-20">
        <div className="mx-auto max-w-7xl print:hidden">
          <InvoiceForm draft={draft} view={view} errors={errors} update={update} disabled={cancelled} part="customer" />
        </div>

        <div className="mx-auto max-w-7xl print:hidden">
          <fieldset disabled={cancelled} className="min-w-0 disabled:opacity-70">
            <MaterialsTable
              products={products}
              view={view}
              error={errors["items"]}
              canEditRate={canEditRate}
              onQty={setQty}
              onRate={setRate}
              limits={limits}
            />
          </fieldset>
        </div>

        <div className="mx-auto max-w-7xl print:hidden">
          <InvoiceForm draft={draft} view={view} errors={errors} update={update} disabled={cancelled} part="info" />
        </div>

        <div className="mx-auto max-w-7xl print:hidden">
          <InvoiceForm draft={draft} view={view} errors={errors} update={update} disabled={cancelled} part="summary" />
        </div>
      </div>

      {/* Floating preview button: always one tap away while filling in the form */}
      <Button
        type="button"
        size="lg"
        onClick={() => setPreview("view")}
        data-testid="floating-preview"
        className="fixed right-5 bottom-5 z-30 h-11 rounded-full px-5 shadow-lg print:hidden"
      >
        <Eye data-icon="inline-start" />
        Preview invoice
        {view.lines.length > 0 && <span className="tabular-nums opacity-90">· {formatRupees(view.totals.roundedTotal)}</span>}
      </Button>

      {/* Proforma preview (exactly what is printed / saved as the PDF) */}
      <Dialog open={preview !== null} onOpenChange={(o) => !o && !saving && setPreview(null)}>
        <DialogContent className="grid-rows-[auto_minmax(0,1fr)_auto] max-h-[94vh] sm:max-w-5xl" data-testid="preview-dialog">
          <DialogHeader>
            <DialogTitle data-testid="preview-title">
              {preview === "submit" ? "Check the proforma invoice, then confirm" : "Proforma invoice preview"}
            </DialogTitle>
            <DialogDescription>
              {preview === "submit"
                ? `This is exactly what will be submitted${draftLike ? "" : " as a new version"}.`
                : "A live view of the invoice as filled in so far. Nothing is saved by looking at it."}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto rounded-md bg-muted p-2 sm:p-4">
            <div className="print-area">
              <PaperFrame maxScale={1.35}>
                <InvoicePaper view={view} products={products} showFullCatalogue />
              </PaperFrame>
            </div>
          </div>
          <DialogFooter>
            {preview === "submit" ? (
              <>
                <DialogClose render={<Button variant="outline" disabled={!!saving} />}>Back to editing</DialogClose>
                <Button onClick={() => save("submit")} disabled={!!saving} data-testid="confirm-submit">
                  {saving === "submit" ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Send data-icon="inline-start" />}
                  Confirm &amp; {submitLabel.toLowerCase()}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => window.print()}>
                  <Printer data-icon="inline-start" />
                  Print
                </Button>
                <DialogClose render={<Button />}>Close</DialogClose>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset confirmation */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard your changes?</DialogTitle>
            <DialogDescription>
              {draft.id
                ? "The invoice goes back to how it was last saved."
                : "The form goes back to a blank invoice."}{" "}
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Keep editing</DialogClose>
            <Button variant="destructive" onClick={reset} data-testid="confirm-reset">
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Submit success */}
      <Dialog open={!!submitted} onOpenChange={(o) => !o && setSubmitted(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-success-fg" />
              {submitted?.version && submitted.version > 1 ? "Revision saved" : "Invoice submitted"}
            </DialogTitle>
            <DialogDescription>
              <span className="font-mono font-medium text-foreground">{submitted?.invoiceNumber}</span>{" "}
              for {submitted?.customer.companyName} —{" "}
              {submitted && formatRupees(submitted.totals.roundedTotal)}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-wrap sm:justify-end">
            <Link href="/invoices" className={buttonVariants({ variant: "outline" })}>
              Invoice history
            </Link>
            <Link href="/invoices/new" className={buttonVariants({ variant: "outline" })}>
              New Proforma
            </Link>
            {submitted && <DownloadButton invoice={submitted} label="Download PDF" />}
            <Link href={submitted ? `/invoices/${submitted.id}` : "/invoices"} className={buttonVariants()}>
              View invoice
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
