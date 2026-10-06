import type { Metadata } from "next";
import { InvoiceEditor } from "@/components/invoice/invoice-editor";

export const metadata: Metadata = { title: "Edit Proforma Invoice" };

export default async function EditInvoicePage(props: PageProps<"/invoices/[id]/edit">) {
  const { id } = await props.params;
  return <InvoiceEditor id={id} />;
}
