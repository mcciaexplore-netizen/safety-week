"use client";

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PaymentSection } from "./payment-section";
import { LABELS, SIGNATORY } from "@/lib/config/app-config";
import { formatMoney, formatRupees } from "@/lib/format";
import {
  type InvoiceDraft,
  type InvoiceView,
} from "@/lib/invoice/model";
import type { FieldErrors } from "@/lib/invoice/validation";
import type { InvoiceCustomer } from "@/lib/types";
import { cn } from "@/lib/utils";

type Update = (updater: (d: InvoiceDraft) => InvoiceDraft) => void;

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-5 rounded-xl glass shadow-card p-6 text-base sm:p-8 [&_input]:h-10 [&_input]:text-base [&_label]:text-base [&_select]:h-10 [&_select]:text-base [&_textarea]:text-base [&_.text-xs]:text-sm">
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  htmlFor,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error && (
        <p className="text-xs text-destructive" data-testid={`error-${htmlFor}`}>
          {error}
        </p>
      )}
    </div>
  );
}

const numberOrZero = (v: string) => (v === "" ? 0 : Number(v));

export function InvoiceForm({
  draft,
  view,
  errors,
  update,
  disabled,
  part,
}: {
  draft: InvoiceDraft;
  view: InvoiceView;
  errors: FieldErrors;
  update: Update;
  disabled: boolean;
  /** customer / info = the two detail sections (info sits below the materials); "summary" = totals, words, payment. */
  part: "customer" | "info" | "summary";
}) {
  const setCustomer = (field: keyof InvoiceCustomer, value: string) =>
    update((d) => ({ ...d, customer: { ...d.customer, [field]: value } }));
  const t = view.totals;

  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-5 disabled:opacity-70">
      {part === "customer" && (
      <Section title="Customer information" hint="Printed in the customer block of the invoice.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={LABELS.companyName}
            htmlFor="companyName"
            error={errors["customer.companyName"]}
            className="sm:col-span-2"
          >
            <Input
              id="companyName"
              value={draft.customer.companyName}
              onChange={(e) => setCustomer("companyName", e.target.value)}
              aria-invalid={!!errors["customer.companyName"]}
              autoComplete="off"
            />
          </Field>
          <Field label={LABELS.address} htmlFor="address" className="sm:col-span-2">
            <Input
              id="address"
              value={draft.customer.address}
              onChange={(e) => setCustomer("address", e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field label={LABELS.gstin} htmlFor="gstin" error={errors["customer.gstin"]}>
            <Input
              id="gstin"
              value={draft.customer.gstin}
              onChange={(e) => setCustomer("gstin", e.target.value.toUpperCase())}
              maxLength={15}
              className="font-mono"
              placeholder="27AAAAA0000A1Z5"
              aria-invalid={!!errors["customer.gstin"]}
            />
          </Field>
          <Field label={LABELS.email} htmlFor="email" error={errors["customer.email"]}>
            <Input
              id="email"
              type="email"
              value={draft.customer.email}
              onChange={(e) => setCustomer("email", e.target.value)}
              aria-invalid={!!errors["customer.email"]}
            />
          </Field>
          <Field label="Contact Person Name" htmlFor="contactPerson">
            <Input
              id="contactPerson"
              value={draft.customer.contactPerson}
              onChange={(e) => setCustomer("contactPerson", e.target.value)}
            />
          </Field>
          <Field label="Mobile No" htmlFor="contactPhone">
            <Input
              id="contactPhone"
              inputMode="tel"
              value={draft.customer.contactPhone}
              onChange={(e) => setCustomer("contactPhone", e.target.value)}
            />
          </Field>
        </div>
      </Section>
      )}

      {part === "info" && (
      <Section title="Invoice information">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={LABELS.invoiceNo} htmlFor="invoiceNo">
            <Input id="invoiceNo" value={draft.invoiceNumber} readOnly className="bg-muted font-mono" />
            <p className="text-xs text-muted-foreground">
              {draft.id ? "Assigned by the system." : "Provisional — confirmed when first saved."}
            </p>
          </Field>
          <Field label={LABELS.invoiceDate} htmlFor="invoiceDate" error={errors["invoiceDate"]}>
            <Input
              id="invoiceDate"
              type="date"
              value={draft.invoiceDate}
              // a new proforma is always dated today (set when the form opens); only an existing invoice can change its date
              readOnly={!draft.id}
              className={!draft.id ? "bg-muted" : undefined}
              onChange={(e) => update((d) => ({ ...d, invoiceDate: e.target.value }))}
              aria-invalid={!!errors["invoiceDate"]}
            />
            {!draft.id && <p className="text-xs text-muted-foreground">Today&apos;s date — fixed for a new invoice.</p>}
          </Field>
          {draft.status && draft.status !== "DRAFT" && (
            <Field
              label="Reason for this change"
              htmlFor="editReason"
              error={errors["editReason"]}
              className="sm:col-span-2"
            >
              <Input
                id="editReason"
                value={draft.editReason}
                onChange={(e) => update((d) => ({ ...d, editReason: e.target.value }))}
                placeholder="e.g. customer increased the quantity"
                maxLength={500}
                aria-invalid={!!errors["editReason"]}
              />
              <p className="text-xs text-muted-foreground">
                Saving creates version {draft.version + 1}; the earlier version is kept on record.
              </p>
            </Field>
          )}
          <Field
            label="Discount on rate (%)"
            htmlFor="discountPercent"
            error={errors["discountPercent"]}
            className="sm:col-span-2"
          >
            <Input
              id="discountPercent"
              type="number"
              min={0}
              max={100}
              step="0.01"
              className="max-w-40"
              value={draft.discountPercent === 0 ? "" : draft.discountPercent}
              placeholder="0"
              onChange={(e) =>
                update((d) => ({ ...d, discountPercent: numberOrZero(e.target.value) }))
              }
            />
            <p className="text-xs text-muted-foreground">
              Taken off every rate before GST, as in the discounted 2026 invoices. When above 0 the
              invoice shows the “{LABELS.rateAfterDiscount}” column.
            </p>
          </Field>
        </div>
      </Section>
      )}

      {part === "summary" && (
      <Section title="Summary and footer">
        <dl className="space-y-1.5 rounded-md bg-secondary/60 p-4 text-base tabular-nums">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{LABELS.basic}</dt>
            <dd>{formatMoney(t.basicTotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{LABELS.cgstAmt}</dt>
            <dd>{formatMoney(t.cgstTotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{LABELS.sgstAmt}</dt>
            <dd>{formatMoney(t.sgstTotal)}</dd>
          </div>
          <div className="flex justify-between border-t pt-1.5">
            <dt>{LABELS.total}</dt>
            <dd data-testid="form-grand-total">{formatMoney(t.grandTotal)}</dd>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <dt>{LABELS.roundedOff}</dt>
            <dd>
              {t.roundingAdjustment >= 0 ? "+" : "−"}
              {formatMoney(Math.abs(t.roundingAdjustment))}
            </dd>
          </div>
          <div className="flex items-baseline justify-between border-t pt-1.5 text-xl font-semibold">
            <dt>Payable (rounded)</dt>
            <dd data-testid="form-rounded-total">{formatRupees(t.roundedTotal)}</dd>
          </div>
        </dl>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="amountInWords">{LABELS.amountInWords}</Label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={draft.amountInWordsOverride === null}
                onChange={(e) =>
                  update((d) => ({
                    ...d,
                    amountInWordsOverride: e.target.checked ? null : view.amountInWords,
                  }))
                }
              />
              Generate automatically
            </label>
          </div>
          <Input
            id="amountInWords"
            value={draft.amountInWordsOverride ?? view.amountInWords}
            readOnly={draft.amountInWordsOverride === null}
            onChange={(e) => update((d) => ({ ...d, amountInWordsOverride: e.target.value }))}
            className={cn(draft.amountInWordsOverride === null && "bg-muted")}
          />
        </div>

        <PaymentSection draft={draft} view={view} errors={errors} update={update} />

        <div className="space-y-1.5">
          <Label htmlFor="paymentDetails">{LABELS.paymentDetails}</Label>
          <Textarea
            id="paymentDetails"
            rows={3}
            value={draft.paymentDetails}
            onChange={(e) => update((d) => ({ ...d, paymentDetails: e.target.value }))}
            placeholder="e.g. UTR - 123456789012  Payer name"
          />
          <p className="text-xs text-muted-foreground">Optional notes, printed after the payment modes above.</p>
        </div>

        <div className="rounded-md border border-dashed p-4 text-base">
          <p className="font-medium">{LABELS.forOrg}</p>
          <p className="text-muted-foreground">
            {LABELS.signatory}
            {SIGNATORY.enabled ? " — the branch seal is applied automatically." : "."}
          </p>
        </div>
      </Section>
      )}
    </fieldset>
  );
}
