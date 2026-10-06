"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatRupees } from "@/lib/format";
import { newKey, type InvoiceDraft, type InvoiceView } from "@/lib/invoice/model";
import { PAYMENT_LABEL, PAYMENT_MODES, REFERENCE_HINT } from "@/lib/invoice/payments";
import type { FieldErrors } from "@/lib/invoice/validation";
import type { PaymentMode } from "@/lib/types";
import { cn } from "@/lib/utils";

type Update = (updater: (d: InvoiceDraft) => InvoiceDraft) => void;
const SELECT =
  "h-10 w-full rounded-lg border border-input bg-background px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Mode of payment. Normal case: pick one mode and the full payable amount is taken automatically.
 * Split payment (customer pays part by UPI, the rest in cash ...): enter each mode with its amount;
 * the balance is shown live and the total can never exceed the invoice. Paying less is allowed
 * (part payment, balance due).
 */
export function PaymentSection({
  draft,
  view,
  errors,
  update,
}: {
  draft: InvoiceDraft;
  view: InvoiceView;
  errors: FieldErrors;
  update: Update;
}) {
  const payable = view.totals.roundedTotal;
  const { paid, balance, status } = view.paymentSummary;
  const rows = draft.payments;

  const setRow = (key: string, patch: Partial<InvoiceDraft["payments"][number]>) =>
    update((d) => ({ ...d, payments: d.payments.map((p) => (p.key === key ? { ...p, ...patch } : p)) }));
  const addRow = () =>
    update((d) => ({ ...d, payments: [...d.payments, { key: newKey(), mode: "CASH", amount: 0, reference: "" }] }));

  function chooseSingle(mode: string) {
    update((d) => ({
      ...d,
      splitPayment: false,
      payments: mode ? [{ key: d.payments[0]?.key ?? newKey(), mode: mode as PaymentMode, amount: payable, reference: d.payments[0]?.reference ?? "" }] : [],
    }));
  }
  function startSplit() {
    // amounts are cleared so the user types the first part, then uses "Fill balance" for the rest
    update((d) => ({
      ...d,
      splitPayment: true,
      payments: [
        { key: d.payments[0]?.key ?? newKey(), mode: d.payments[0]?.mode ?? "UPI", amount: 0, reference: d.payments[0]?.reference ?? "" },
        { key: newKey(), mode: "CASH", amount: 0, reference: "" },
      ],
    }));
  }
  function backToSingle() {
    update((d) => ({ ...d, splitPayment: false, payments: d.payments.slice(0, 1).map((p) => ({ ...p, amount: payable })) }));
  }

  const badge =
    status === "PAID"
      ? { text: "Paid in full", cls: "bg-emerald-100 text-emerald-900" }
      : status === "PARTIAL"
        ? { text: `Part payment — balance due ${formatRupees(balance)}`, cls: "bg-amber-100 text-amber-900" }
        : { text: "Not paid yet", cls: "bg-slate-100 text-slate-700" };

  return (
    <div className="space-y-3 rounded-md border p-3" data-testid="payment-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor="pay-mode-0">Mode of payment</Label>
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", badge.cls)} data-testid="payment-status">
          {badge.text}
        </span>
      </div>

      {!draft.splitPayment ? (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,180px)_1fr_auto]">
          <select id="pay-mode-0" className={SELECT} value={rows[0]?.mode ?? ""} onChange={(e) => chooseSingle(e.target.value)}>
            <option value="">Not paid yet</option>
            {PAYMENT_MODES.map((m) => (
              <option key={m} value={m}>{PAYMENT_LABEL[m]}</option>
            ))}
          </select>
          {rows[0] ? (
            <div>
              <Input
                aria-label="Payment reference"
                placeholder={REFERENCE_HINT[rows[0].mode]}
                value={rows[0].reference}
                onChange={(e) => setRow(rows[0].key, { reference: e.target.value })}
                aria-invalid={!!errors["payments.0.reference"]}
              />
              {errors["payments.0.reference"] && <p className="mt-1 text-xs text-destructive">{errors["payments.0.reference"]}</p>}
            </div>
          ) : (
            <span />
          )}
          <Button type="button" variant="outline" onClick={startSplit} data-testid="split-payment">
            Split payment
          </Button>
          {rows[0] && (
            <p className="text-base text-muted-foreground sm:col-span-3">
              Full amount received: <strong className="text-foreground">{formatRupees(payable)}</strong>
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Enter what was paid in each mode. Use “Fill balance” to put the remaining amount on a row. The total cannot be more than the invoice.
          </p>
          {rows.map((r, i) => (
            <div key={r.key} className="grid gap-2 sm:grid-cols-[minmax(0,150px)_minmax(0,140px)_1fr_auto_auto]" data-testid="payment-row">
              <select
                id={`pay-mode-${i}`}
                aria-label={`Mode for payment ${i + 1}`}
                className={SELECT}
                value={r.mode}
                onChange={(e) => setRow(r.key, { mode: e.target.value as PaymentMode })}
              >
                {PAYMENT_MODES.map((m) => (
                  <option key={m} value={m}>{PAYMENT_LABEL[m]}</option>
                ))}
              </select>
              <div>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Amount ₹"
                  aria-label={`Amount for payment ${i + 1}`}
                  value={r.amount || ""}
                  onChange={(e) => setRow(r.key, { amount: Math.max(0, Number(e.target.value) || 0) })}
                  aria-invalid={!!errors[`payments.${i}.amount`]}
                />
                {errors[`payments.${i}.amount`] && <p className="mt-1 text-xs text-destructive">{errors[`payments.${i}.amount`]}</p>}
              </div>
              <div>
                <Input
                  aria-label={`Reference for payment ${i + 1}`}
                  placeholder={REFERENCE_HINT[r.mode]}
                  value={r.reference}
                  onChange={(e) => setRow(r.key, { reference: e.target.value })}
                  aria-invalid={!!errors[`payments.${i}.reference`]}
                />
                {errors[`payments.${i}.reference`] && <p className="mt-1 text-xs text-destructive">{errors[`payments.${i}.reference`]}</p>}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={balance <= 0}
                aria-label={`Fill balance on payment ${i + 1}`}
                onClick={() => setRow(r.key, { amount: Math.round((r.amount + balance) * 100) / 100 })}
              >
                Fill balance
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove payment ${i + 1}`}
                disabled={rows.length <= 1}
                onClick={() => update((d) => ({ ...d, payments: d.payments.filter((p) => p.key !== r.key) }))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          {errors["payments"] && (
            <p role="alert" data-testid="error-payments" className="text-sm text-destructive">{errors["payments"]}</p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={rows.length >= 6}>
                <Plus data-icon="inline-start" />
                Add payment mode
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={backToSingle}>
                Back to a single payment
              </Button>
            </div>
            <p className="text-base tabular-nums" data-testid="payment-summary">
              Paid <strong>{formatRupees(paid)}</strong> of {formatRupees(payable)}
              {" · "}
              <span className={cn(balance < 0 ? "text-destructive" : balance > 0 ? "text-amber-700" : "text-emerald-700")}>
                {balance < 0 ? `over by ${formatRupees(-balance)}` : `balance ${formatRupees(balance)}`}
              </span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
