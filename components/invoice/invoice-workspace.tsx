"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileEdit, Loader2, Printer, RotateCcw, Save, Send } from "lucide-react";
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
import { useSession } from "@/hooks/use-session";
import { formatDateTime, formatRupees } from "@/lib/format";
import { computeView, invoiceToDraft, itemFromProduct, withSyncedPayment, type InvoiceDraft } from "@/lib/invoice/model";
import { validateDraft, ValidationError, type ValidationMode } from "@/lib/invoice/validation";
import { services } from "@/lib/services";
import type { Invoice, Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { InvoiceForm } from "./invoice-form";
import { InvoicePaper, PaperFrame } from "./invoice-paper";

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
  // The right side is the editable order sheet; the read-only preview appears only after Save Draft / Submit.
  const [mode, setMode] = useState<"edit" | "preview">("edit");

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
      setMode("preview"); // saved: now show the finished invoice
      if (action === "submit") setSubmitted(inv);
      else setNotice(`Draft saved at ${formatDateTime(inv.updatedAt)}`);
    } catch (e) {
      if (e instanceof ValidationError) setAttempted(mode);
      setServerError(e instanceof Error ? e.message : "Could not save the invoice.");
    } finally {
      setSaving(null);
    }
  }

  function reset() {
    setDraft(saved);
    setAttempted(null);
    setServerError(null);
    setNotice("Changes discarded");
    setResetOpen(false);
  }

  const title = draft.id ? "Edit Pro Forma Invoice" : "New Pro Forma Invoice";
  const submitLabel = draftLike ? "Submit" : "Save revision";

  return (
    <div className="mx-auto max-w-[1600px]">
      {/* Action bar */}
      <div className="sticky top-14 z-20 -mx-4 mb-4 border-b bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight sm:text-xl">{title}</h1>
              {draft.status && <StatusBadge status={draft.status} />}
              {draft.id && <span className="text-xs text-muted-foreground">v{draft.version}</span>}
            </div>
            <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
              <span className="font-mono">{draft.invoiceNumber}</span>
              <span data-testid="save-state" className={cn(dirty && "text-amber-700")}>
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
            <Button type="button" variant="outline" onClick={() => window.print()}>
              <Printer data-icon="inline-start" />
              Print preview
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
            <Button type="button" onClick={() => save("submit")} disabled={!!saving || cancelled}>
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

      {/* One column, top to bottom: customer + invoice details, the invoice sheet, then the summary. */}
      <div className="space-y-6">
        <div className="mx-auto max-w-5xl print:hidden">
          <InvoiceForm draft={draft} view={view} errors={errors} update={update} disabled={cancelled} part="details" />
        </div>

        <div className="min-w-0 print:block">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3 print:hidden">
            {mode === "edit" ? (
              <p className="text-sm">
                <span className="font-medium">Invoice</span>{" "}
                <span className="text-muted-foreground">
                  — click a <strong>Qty.</strong> cell and type a number; amounts fill in automatically. Rows left empty stay on the invoice as a reminder.
                </span>
              </p>
            ) : (
              <p className="text-sm font-medium" data-testid="preview-title">Saved invoice preview</p>
            )}
            {mode === "preview" && !cancelled && (
              <Button variant="outline" size="sm" onClick={() => setMode("edit")} data-testid="edit-quantities">
                <FileEdit data-icon="inline-start" />
                Edit quantities
              </Button>
            )}
          </div>
          {errors["items"] && mode === "edit" && (
            <p role="alert" data-testid="error-items" className="mb-2 text-sm text-destructive print:hidden">
              {errors["items"]}
            </p>
          )}
          <div className="print-area rounded-md bg-neutral-200 p-2 sm:p-4 print:bg-transparent print:p-0">
            <PaperFrame maxScale={1.35}>
              <InvoicePaper
                view={view}
                products={products}
                showFullCatalogue
                editable={mode === "edit" && !cancelled ? { onQty: setQty, canEditRate, onRate: setRate } : undefined}
              />
            </PaperFrame>
          </div>
        </div>

        <div className="mx-auto max-w-5xl print:hidden">
          <InvoiceForm draft={draft} view={view} errors={errors} update={update} disabled={cancelled} part="summary" />
        </div>
      </div>

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
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-emerald-600" />
              {submitted?.version && submitted.version > 1 ? "Revision saved" : "Invoice submitted"}
            </DialogTitle>
            <DialogDescription>
              <span className="font-mono font-medium text-foreground">{submitted?.invoiceNumber}</span>{" "}
              for {submitted?.customer.companyName} —{" "}
              {submitted && formatRupees(submitted.totals.roundedTotal)}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Link href="/invoices" className={buttonVariants({ variant: "outline" })}>
              Invoice history
            </Link>
            <Link href="/invoices/new" className={buttonVariants({ variant: "outline" })}>
              New Pro Forma
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
