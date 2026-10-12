"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { API_MODE } from "@/lib/services";
import { api } from "@/lib/services/api";

type ReceiptItem = { particulars: string; copies: number; price: string; amount: string };
type OfficialReceipt = {
  id: string;
  serial_no: string;
  receipt_date: string;
  branch: string;
  party_name: string;
  gstin: string;
  items: ReceiptItem[];
  total: string;
  issued_by: string;
  official: true;
};

function clean(value: string, max = 120) {
  return value.replace(/[<>]/g, "").trim().slice(0, max);
}

function displayDate(raw: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00`) : new Date();
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function money(value: string | number) {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0);
}

export function ReceiptPreview({
  invoice,
  invoiceId,
  party,
  gstin,
  amount: rawAmount,
  branch,
  issuer,
  date,
}: {
  invoice: string;
  invoiceId: string;
  party: string;
  gstin: string;
  amount: string;
  branch: string;
  issuer: string;
  date: string;
}) {
  const [receipt, setReceipt] = useState<OfficialReceipt | null>(null);
  const [loading, setLoading] = useState(Boolean(invoiceId && API_MODE));
  const [error, setError] = useState<string | null>(null);
  const amount = Number(rawAmount);
  const localValid = Number.isFinite(amount) && amount > 0 && clean(party) !== "";

  useEffect(() => {
    if (!invoiceId || !API_MODE) return;
    let active = true;
    api<OfficialReceipt>(`/invoices/${encodeURIComponent(invoiceId)}/cash-receipt`)
      .then((data) => { if (active) setReceipt(data); })
      .catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : "Could not load this receipt."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [invoiceId]);

  const official = Boolean(receipt?.official);
  const ready = official || (!API_MODE && !invoiceId && localValid);
  const rows = receipt?.items ?? [{
    particulars: `Cash received for Safety Week invoice ${clean(invoice, 50)}`,
    copies: 1,
    price: Number.isFinite(amount) ? amount.toFixed(2) : "0.00",
    amount: Number.isFinite(amount) ? amount.toFixed(2) : "0.00",
  }];
  const total = receipt?.total ?? (Number.isFinite(amount) ? amount.toFixed(2) : "0.00");

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-950 print:min-h-0 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-[900px] items-center justify-between print:hidden">
        {!official && <p className="rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
          LOCAL PREVIEW ONLY · No official receipt has been issued
        </p>}
        {ready && <Button onClick={() => window.print()}><Printer data-icon="inline-start" />Print / Save as PDF</Button>}
      </div>

      {loading && <p className="mx-auto max-w-[900px] rounded border bg-white p-5">Loading the saved Payment Desk receipt…</p>}
      {error && <div role="alert" className="mx-auto max-w-[900px] rounded border border-red-300 bg-white p-5 text-red-700">{error}<p className="mt-2"><Link className="underline" href="/invoices">Return to invoices</Link></p></div>}
      {!loading && !error && !ready && <p role="alert" className="mx-auto max-w-[900px] rounded border border-red-300 bg-white p-5 text-red-700">Receipt details are missing. Open the receipt from the invoice confirmation after a successful save.</p>}

      {ready && (
        <article className="receipt-preview mx-auto max-w-[900px] border border-slate-400 bg-white px-10 py-7 shadow-sm print:max-w-none print:border-black print:px-7 print:py-4 print:shadow-none">
          <div className="mb-1 flex justify-center"><Image src="/brand/mccia-logo.png" alt="MCCIA" width={110} height={44} priority className="h-10 w-auto object-contain" /></div>
          <h1 className="text-center text-xl font-bold tracking-wide">CASH RECEIPT</h1>
          <p className="mt-3 text-center text-sm font-bold uppercase">Mahratta Chamber of Commerce, Industries &amp; Agriculture</p>
          <p className="text-center text-xs">505 &amp; 506 A &amp; B Wing, 5th Floor, MCCIA Trade Tower, International Convention Centre,</p>
          <p className="text-center text-xs">403 - A Senapati Bapat Road, Pune - 411 016 · Ph. 25709000</p>
          <div className="mt-2 flex justify-between text-xs"><span>GSTIN: 27AAATM5559Q1ZS</span><span>PAN: AAATM5559Q</span></div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span><strong>Receipt No:</strong> <strong>{official ? receipt!.serial_no : "PREVIEW ONLY"}</strong></span>
            <span><strong>Date:</strong> <strong>{displayDate(receipt?.receipt_date ?? date)}</strong></span>
          </div>
          <p className="mt-3 border-b border-black pb-2 text-sm"><strong>M/s {clean(receipt?.party_name ?? party)}</strong></p>
          <p className="border-b border-black py-1 text-xs">GSTIN: {clean(receipt?.gstin ?? gstin, 30)}</p>
          <p className="mt-1 text-right text-xs">Branch: {clean(receipt?.branch ?? branch, 80)}</p>

          <table className="mt-3 w-full border-collapse text-sm">
            <thead><tr className="bg-slate-100">
              <th className="border border-black px-2 py-2 text-left">PARTICULARS</th>
              <th className="w-24 border border-black px-2 py-2">COPIES</th>
              <th className="w-32 border border-black px-2 py-2">PRICE</th>
              <th className="w-40 border border-black px-2 py-2 text-right">AMOUNT Rs.</th>
            </tr></thead>
            <tbody>
              {rows.map((item, index) => <tr key={`${item.particulars}-${index}`}>
                <td className="border border-black px-2 py-3">{index + 1}) {clean(item.particulars, 240)}</td>
                <td className="border border-black px-2 py-3 text-center">{item.copies}</td>
                <td className="border border-black px-2 py-3 text-right">{money(item.price)}</td>
                <td className="border border-black px-2 py-3 text-right">{money(item.amount)}</td>
              </tr>)}
              <tr><td colSpan={3} className="border border-black px-2 py-2 text-right font-bold">Total</td>
                <td className="border border-black px-2 py-2 text-right font-bold">{money(total)}</td></tr>
            </tbody>
          </table>
          <div className="mt-7 flex justify-end text-right text-xs">
            <div className="min-w-48 border-t border-black pt-2"><strong>Issued by</strong><br />{clean(receipt?.issued_by ?? issuer, 80)}</div>
          </div>
          {!official && <p className="mt-4 text-center text-[10px] font-bold tracking-wide text-red-700">LOCAL PREVIEW ONLY — NOT AN OFFICIAL MCCIA RECEIPT</p>}
        </article>
      )}
      <style jsx global>{`
        @page { size: A5 landscape; margin: 8mm; }
        @media print {
          html, body { background: white !important; }
          .receipt-preview { break-inside: avoid; }
        }
      `}</style>
    </main>
  );
}
