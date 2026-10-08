import type { InvoicePayment, PaymentMode, PaymentStatus } from "@/lib/types";

/** What the screens offer: cash, or Razorpay (UPI / card / net banking taken through Razorpay, at the counter or online).
 *  Older invoices may still carry UPI / Card / Net banking / Other, so those keep their labels below. */
export const PAYMENT_MODES: PaymentMode[] = ["CASH", "RAZORPAY"];

/** The two choices staff are offered (invoices show the shorter PAYMENT_LABEL). */
export const PAYMENT_OPTION_LABEL: Record<"CASH" | "RAZORPAY", string> = { CASH: "Cash", RAZORPAY: "Razorpay UPI" };

export const PAYMENT_LABEL: Record<PaymentMode, string> = {
  CASH: "Cash",
  RAZORPAY: "Razorpay",
  UPI: "UPI",
  CARD: "Card",
  NET_BANKING: "Net banking",
  OTHER: "Other",
};

/** What to type in the reference box for each mode. */
export const REFERENCE_HINT: Record<PaymentMode, string> = {
  CASH: "Receipt no. (optional)",
  RAZORPAY: "Filled in automatically once the customer has paid",
  UPI: "UTR / transaction no.",
  CARD: "Card slip / approval no.",
  NET_BANKING: "UTR / reference no.",
  OTHER: "Say how it was paid (required)",
};

const paise = (n: number) => Math.round(n * 100);

export interface PaymentSummary {
  paid: number;
  balance: number;
  status: PaymentStatus;
}

/** Same rule as the server: no money = unpaid; less than the payable = part payment; all of it = paid. */
export function summarizePayments(payments: { amount: number }[], payable: number): PaymentSummary {
  const paidP = payments.reduce((a, p) => a + paise(p.amount), 0);
  const payableP = paise(payable);
  return {
    paid: paidP / 100,
    balance: (payableP - paidP) / 100,
    status: paidP <= 0 ? "UNPAID" : paidP >= payableP ? "PAID" : "PARTIAL",
  };
}

const money = (n: number) => `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The line printed after "Payment Details :" on the invoice, e.g.
 * "UPI Rs. 2,000.00 (UTR 6047…) + Cash Rs. 1,938.00". Rs. (not the rupee sign) so every PDF font shows it.
 */
export function paymentText(payments: InvoicePayment[], summary: PaymentSummary, notes: string): string {
  const parts = payments.map((p) => `${PAYMENT_LABEL[p.mode]} ${money(p.amount)}${p.reference ? ` (${p.reference})` : ""}`);
  const lines = [parts.join(" + ")];
  if (payments.length > 0 && summary.balance > 0) lines.push(`Balance due ${money(summary.balance)}`);
  if (notes.trim()) lines.push(notes.trim());
  return lines.filter(Boolean).join("  |  ");
}
