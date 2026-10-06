import type { Metadata } from "next";
import { InvoiceEditor } from "@/components/invoice/invoice-editor";

export const metadata: Metadata = { title: "New Proforma Invoice" };

export default function NewInvoicePage() {
  return <InvoiceEditor />;
}
