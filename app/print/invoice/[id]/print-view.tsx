"use client";

import { InvoicePaper, PaperFrame } from "@/components/invoice/invoice-paper";
import { useAsync } from "@/hooks/use-async";
import { invoiceToView } from "@/lib/invoice/model";
import { API_URL, api, toInvoice } from "@/lib/services/api";

export function PrintView({ id, version, token }: { id: string; version: string; token: string }) {
  const data = useAsync(async () => {
    const res = await fetch(`${API_URL}/api/v1/print/${id}?v=${encodeURIComponent(version)}&t=${encodeURIComponent(token)}`);
    if (!res.ok) throw new Error("This print link is invalid or has expired.");
    const view = invoiceToView(toInvoice(await res.json()));
    // the whole catalogue is printed (unbought rows show "-"), so it needs the product list too
    const products = (await api<{ id: string; sku: string; name: string; hsn_code: string; unit: string; current_rate: string;
      cgst_rate: string; sr_no: number | null; line_order: number }[]>("/products"))
      .map((p) => ({ id: p.id, sku: p.sku, name: p.name, hsnCode: p.hsn_code, unit: p.unit, currentRate: Number(p.current_rate),
        gstHalfRate: Number(p.cgst_rate), srNo: p.sr_no, lineOrder: p.line_order, active: true }));
    return { view, products };
  }, `print:${id}:${version}`);

  if (data.error) return <p role="alert" className="p-8 text-red-700">{data.error.message}</p>;
  if (!data.data) return null;
  return (
    <div className="print-area bg-white">
      {/* Same component as the editor and the saved preview. */}
      <PaperFrame>
        <InvoicePaper view={data.data.view} products={data.data.products} ready />
      </PaperFrame>
    </div>
  );
}
