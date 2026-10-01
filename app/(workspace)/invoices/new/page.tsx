import type { Metadata } from "next";
import { InvoiceEditor } from "@/components/invoice/invoice-editor";

export const metadata: Metadata = { title: "New Pro Forma Invoice" };

export default function NewInvoicePage() {
  return <InvoiceEditor />;
}
