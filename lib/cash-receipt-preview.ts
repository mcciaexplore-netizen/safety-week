import type { Invoice } from "@/lib/types";

/** Local-only preview URL. It does not create or number an official receipt. */
export function cashReceiptPreviewUrl(input: {
  invoice: Invoice;
  amount: number;
  branch: string;
  issuer: string;
}): string {
  const params = new URLSearchParams({
    invoice: input.invoice.invoiceNumber,
    party: input.invoice.customer.companyName,
    gstin: input.invoice.customer.gstin,
    amount: input.amount.toFixed(2),
    branch: input.branch,
    issuer: input.issuer,
    date: input.invoice.invoiceDate.slice(0, 10),
  });
  return `/cash-receipt-preview?${params.toString()}`;
}
