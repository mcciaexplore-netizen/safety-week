import { Badge } from "@/components/ui/badge";
import { summarizePayments } from "@/lib/invoice/payments";
import type { Invoice, InvoiceStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STYLES: Record<InvoiceStatus, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-warning/10 text-warning border-warning/20" },
  SUBMITTED: { label: "Submitted", className: "bg-brand/10 text-brand border-brand/20" },
  GENERATED: { label: "PDF generated", className: "bg-success/10 text-success-fg border-success/20" },
  EDITED: { label: "Edited", className: "bg-violet/10 text-violet border-violet/20" },
  CANCELLED: { label: "Cancelled", className: "bg-muted text-muted-foreground border-border" },
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
      ? "bg-success/10 text-success-fg border-success/20"
      : s.status === "PARTIAL"
        ? "bg-warning/10 text-warning border-warning/20"
        : "bg-muted text-muted-foreground border-border";
  const modes = [...new Set((invoice.payments ?? []).map((p) => p.mode))].join(" + ");
  return (
    <Badge variant="outline" className={cn("font-medium", style)} title={modes || "No payment recorded"}>
      {s.status === "PAID" ? "Paid" : s.status === "PARTIAL" ? "Part paid" : "Unpaid"}
    </Badge>
  );
}
