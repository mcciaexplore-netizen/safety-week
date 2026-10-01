import { Badge } from "@/components/ui/badge";
import { summarizePayments } from "@/lib/invoice/payments";
import type { Invoice, InvoiceStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STYLES: Record<InvoiceStatus, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-amber-100 text-amber-900 border-amber-200" },
  SUBMITTED: { label: "Submitted", className: "bg-blue-100 text-blue-900 border-blue-200" },
  GENERATED: { label: "PDF generated", className: "bg-emerald-100 text-emerald-900 border-emerald-200" },
  EDITED: { label: "Edited", className: "bg-violet-100 text-violet-900 border-violet-200" },
  CANCELLED: { label: "Cancelled", className: "bg-slate-200 text-slate-700 border-slate-300" },
};

export const STATUS_LABEL = (s: InvoiceStatus) => STYLES[s].label;

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  const s = STYLES[status];
  return (
    <Badge variant="outline" className={cn("font-medium", s.className)}>
      {s.label}
    </Badge>
  );
}

/** Paid / part-paid / unpaid, from the invoice's payments (drafts have no payment status yet). */
export function PaymentBadge({ invoice }: { invoice: Pick<Invoice, "status" | "payments" | "totals"> }) {
  if (invoice.status === "DRAFT" || invoice.status === "CANCELLED") return <span className="text-muted-foreground">—</span>;
  const s = summarizePayments(invoice.payments ?? [], invoice.totals.roundedTotal);
  const style =
    s.status === "PAID"
      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
      : s.status === "PARTIAL"
        ? "bg-amber-50 text-amber-800 border-amber-200"
        : "bg-slate-100 text-slate-700 border-slate-200";
  const modes = [...new Set((invoice.payments ?? []).map((p) => p.mode))].join(" + ");
  return (
    <Badge variant="outline" className={cn("font-medium", style)} title={modes || "No payment recorded"}>
      {s.status === "PAID" ? "Paid" : s.status === "PARTIAL" ? "Part paid" : "Unpaid"}
    </Badge>
  );
}
