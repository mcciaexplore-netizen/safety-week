import { InvoiceDetailView } from "@/components/app/invoice-detail-view";

export default async function InvoicePage(props: PageProps<"/invoices/[id]">) {
  const { id } = await props.params;
  return <InvoiceDetailView id={id} />;
}
