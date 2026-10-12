import { ReceiptPreview } from "@/components/cash-receipt/receipt-preview";

export default async function CashReceiptPreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const value = (key: string) => {
    const entry = params[key];
    return typeof entry === "string" ? entry : "";
  };

  return (
    <ReceiptPreview
      invoice={value("invoice")}
      invoiceId={value("invoiceId")}
      party={value("party")}
      gstin={value("gstin")}
      amount={value("amount")}
      branch={value("branch")}
      issuer={value("issuer")}
      date={value("date")}
    />
  );
}
