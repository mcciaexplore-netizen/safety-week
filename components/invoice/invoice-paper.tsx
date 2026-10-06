"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { LABELS, SIGNATORY } from "@/lib/config/app-config";
import { useInvoiceHeader } from "@/hooks/use-invoice-header";
import { formatInvoiceDate, formatMoney } from "@/lib/format";
import { computeLine } from "@/lib/invoice/calc";
import type { InvoiceView } from "@/lib/invoice/model";
import { paymentText } from "@/lib/invoice/payments";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The printed MCCIA Proforma Invoice. One <table> mirrors the Excel sheet's
 * merge structure (docs/invoice-spec.md §1-§7), so columns line up exactly as in
 * the workbook. Pure: it renders an `InvoiceView` and owns no state. The same
 * component will be rendered by the PDF pipeline later (PLAN Phase 7).
 *
 * Standard layout = 11 columns; with a discount it gains the workbook's
 * "Rate after Discount" column (12 columns) and every span shifts by one.
 */

export const PAPER_WIDTH = 794; // A4 at 96 dpi

/** `NSW27-TIL-000007` -> `/brand/seals/TIL.png` (the five seal files live in public/brand/seals). */
function sealFor(invoiceNumber: string): string {
  const code = /^[A-Z0-9]+-([A-Z]{3})-\d+$/.exec(invoiceNumber)?.[1];
  return code ? `${SIGNATORY.sealDir}/${code}.png` : SIGNATORY.stampSrc;
}

type ColKey =
  | "sr" | "part" | "hsn" | "rate" | "qty" | "rad"
  | "basic" | "cgstR" | "cgstA" | "sgstR" | "sgstA" | "total";

interface ColDef {
  key: ColKey;
  label: string;
  width: number; // Excel character units from the workbook
  align: "left" | "center" | "right";
}

const STD_COLS: ColDef[] = [
  { key: "sr", label: LABELS.sr, width: 5.56, align: "center" },
  { key: "part", label: LABELS.particulars, width: 28.67, align: "left" },
  { key: "hsn", label: LABELS.hsn, width: 9.33, align: "left" },
  { key: "rate", label: LABELS.rate, width: 7.33, align: "right" },
  { key: "qty", label: LABELS.qty, width: 7.56, align: "center" },
  { key: "basic", label: LABELS.basic, width: 9.67, align: "right" },
  { key: "cgstR", label: LABELS.cgstRate, width: 6.56, align: "center" },
  { key: "cgstA", label: LABELS.cgstAmt, width: 8.67, align: "right" },
  { key: "sgstR", label: LABELS.sgstRate, width: 6.56, align: "center" },
  { key: "sgstA", label: LABELS.sgstAmt, width: 8.11, align: "right" },
  { key: "total", label: LABELS.total, width: 12.78, align: "right" },
];

const DISC_COL: ColDef = {
  key: "rad",
  label: LABELS.rateAfterDiscount,
  width: 8.89,
  align: "right",
};

interface PaperRow {
  productId: string | null;
  sr: number | null;
  particulars: string;
  hsn: string;
  rate: number;
  qty: number;
  rad: number;
  basic: number;
  cgstR: number;
  cgstA: number;
  sgstR: number;
  sgstA: number;
  total: number;
}

function buildRows(view: InvoiceView, products: Product[], full: boolean): PaperRow[] {
  const fromLine = (l: InvoiceView["lines"][number], sr: number | null): PaperRow => ({
    productId: l.productId,
    sr,
    particulars: l.particulars,
    hsn: l.hsnCode,
    rate: l.rate,
    qty: l.quantity,
    rad: l.rateAfterDiscount,
    basic: l.basicAmount,
    cgstR: l.cgstRate,
    cgstA: l.cgstAmount,
    sgstR: l.sgstRate,
    sgstA: l.sgstAmount,
    total: l.totalAmount,
  });

  if (!full) return view.lines.map((l, i) => fromLine(l, i + 1));

  // Full-catalogue mode: every workbook row, in workbook order, as printed in the Excel.
  const byProduct = new Map(view.lines.filter((l) => l.productId).map((l) => [l.productId, l]));
  // numbered 1..n in the order shown (the workbook's own Sr. skips the variant rows)
  const rows: PaperRow[] = products.map((p, idx) => {
    const line = byProduct.get(p.id);
    if (line) return fromLine(line, idx + 1);
    const c = computeLine({
      rate: p.currentRate,
      quantity: 0,
      discountPercent: view.discountPercent,
      cgstRate: p.gstHalfRate,
      sgstRate: p.gstHalfRate,
    });
    return {
      productId: p.id,
      sr: idx + 1,
      particulars: p.name,
      hsn: p.hsnCode,
      rate: p.currentRate,
      qty: 0,
      rad: c.rateAfterDiscount,
      basic: 0,
      cgstR: p.gstHalfRate,
      cgstA: 0,
      sgstR: p.gstHalfRate,
      sgstA: 0,
      total: 0,
    };
  });
  // Lines whose product is no longer in the list (deactivated, or a custom line) must never disappear.
  const listed = new Set(products.map((p) => p.id));
  for (const l of view.lines) if (!l.productId || !listed.has(l.productId)) rows.push(fromLine(l, rows.length + 1));
  return rows;
}

/** Excel accounting style: zero shows as a dash. */
const money = (n: number) => (Math.abs(n) < 0.0005 ? "-" : formatMoney(n));
const pct = (n: number) => `${n.toFixed(1)}%`;

function renderCell(key: ColKey, r: PaperRow): string {
  switch (key) {
    case "sr": return r.sr === null ? "" : String(r.sr);
    case "part": return r.particulars;
    case "hsn": return r.hsn;
    case "rate": return formatMoney(r.rate);
    case "qty": return r.qty ? String(r.qty) : "";
    case "rad": return formatMoney(r.rad);
    case "basic": return money(r.basic);
    case "cgstR": return pct(r.cgstR);
    case "cgstA": return money(r.cgstA);
    case "sgstR": return pct(r.sgstR);
    case "sgstA": return money(r.sgstA);
    case "total": return money(r.total);
  }
}

const B = "border border-black";
const HEAD_FILL = "#C5D9F1"; // header/total fill in the workbook (Excel colour index 24)

function Td({
  children,
  className,
  ...rest
}: {
  children?: ReactNode;
  className?: string;
  colSpan?: number;
  rowSpan?: number;
  style?: CSSProperties;
  "data-testid"?: string;
}) {
  return (
    <td className={cn("px-[3px] align-middle", className)} {...rest}>
      {children}
    </td>
  );
}

export function InvoicePaper({
  view,
  products,
  showFullCatalogue = true,
  ready = false,
  editable,
}: {
  view: InvoiceView;
  products: Product[];
  showFullCatalogue?: boolean;
  /** Set by the print page once data is in, so the PDF renderer knows when to print. */
  ready?: boolean;
  /** Turns the Qty. column (and, for admins, Rate) into inputs: the sheet IS the order form. */
  editable?: { onQty: (productId: string, qty: number) => void; canEditRate?: boolean; onRate?: (productId: string, rate: number) => void };
}) {
  const { header, loaded } = useInvoiceHeader();
  const disc = view.discountPercent > 0;
  const cols = disc ? [...STD_COLS.slice(0, 5), DISC_COL, ...STD_COLS.slice(5)] : STD_COLS;
  const n = cols.length;
  const totalWidth = cols.reduce((a, c) => a + c.width, 0);
  const L = n - 3; // width of the left-hand blocks (customer, words, payment)
  const H = n - 2; // width of the header text block (logo takes the last two columns)
  const radIndex = cols.findIndex((c) => c.key === "rad");
  const rows = buildRows(view, products, showFullCatalogue);
  const c = view.customer;
  const t = view.totals;
  const hasLines = view.lines.length > 0;
  const words = hasLines ? view.amountInWords : "";

  const totalCell = (key: ColKey): string => {
    switch (key) {
      case "part": return LABELS.totalRow;
      case "qty": return formatMoney(t.totalQuantity);
      case "basic": return formatMoney(t.basicTotal);
      case "cgstA": return formatMoney(t.cgstTotal);
      case "sgstA": return formatMoney(t.sgstTotal);
      case "total": return formatMoney(t.grandTotal);
      default: return "";
    }
  };

  return (
    <div
      data-testid="invoice-paper"
      data-ready={ready && loaded ? "1" : undefined}
      className="paper bg-white px-[30px] pb-[34px] pt-[30px] text-[10.5px] leading-[1.25] text-black shadow-md"
      style={{ fontFamily: "Calibri, Carlito, 'Segoe UI', Arial, sans-serif" }}
    >
      <table className="w-full border-collapse" style={{ tableLayout: "fixed" }}>
        <colgroup>
          {cols.map((col) => (
            <col key={col.key} style={{ width: `${(col.width / totalWidth) * 100}%` }} />
          ))}
        </colgroup>
        <tbody>
          {/* Row 1 — title */}
          <tr>
            <Td colSpan={n} className={cn(B, "h-[26px] text-center text-[13px] font-bold")}>
              {header.title}
            </Td>
          </tr>

          {/* Rows 2-5 — issuer block with logo in the merged corner */}
          <tr>
            <Td colSpan={H} className="h-[22px] border-l border-black text-[13px] font-bold">
              {header.name}
            </Td>
            <Td rowSpan={4} colSpan={2} className="border-b border-r border-black text-center">
              {SIGNATORY.enabled && (
                <Image
                  src={SIGNATORY.logoSrc}
                  alt="MCCIA"
                  width={100}
                  height={33}
                  className="mx-auto h-auto w-[92px]"
                  priority
                />
              )}
            </Td>
          </tr>
          <tr>
            <Td colSpan={H} className="h-[19px] whitespace-pre border-l border-black">
              {header.addressLines[0]}
            </Td>
          </tr>
          <tr>
            <Td colSpan={H} className="h-[19px] whitespace-pre border-l border-black">
              {header.addressLines[1]}
            </Td>
          </tr>
          <tr>
            <Td colSpan={H} className="h-[21px] whitespace-pre border-b border-l border-black font-bold">
              {`GSTIN - ${header.gstin}   PAN - ${header.pan}`}
            </Td>
          </tr>

          {/* Row 6 — spacer */}
          <tr>
            <Td colSpan={n} className="h-[9px] border-x border-black" />
          </tr>

          {/* Rows 7-11 — customer (left) and invoice metadata (right) */}
          <tr>
            <Td colSpan={L} className={cn(B, "h-[22px] whitespace-pre font-bold")} data-testid="paper-company">
              {`${LABELS.companyName}  : ${c.companyName}`}
            </Td>
            <Td colSpan={2} rowSpan={2} className={cn(B, "font-bold")}>
              {LABELS.invoiceNo}
            </Td>
            <Td rowSpan={2} className={cn(B, "whitespace-nowrap text-[8.5px] font-bold")} data-testid="paper-invoice-no">
              {view.invoiceNumber}
            </Td>
          </tr>
          <tr>
            <Td colSpan={L} className={cn(B, "h-[26px] whitespace-pre font-bold")} data-testid="paper-address">
              {`${LABELS.address} : ${c.address}`}
            </Td>
          </tr>
          <tr>
            <Td colSpan={L} className={cn(B, "h-[16px]")} />
            <Td colSpan={2} rowSpan={2} className={cn(B, "font-bold")}>
              {LABELS.invoiceDate}
            </Td>
            <Td rowSpan={2} className={cn(B, "text-center font-bold")} data-testid="paper-date">
              {view.invoiceDate ? formatInvoiceDate(view.invoiceDate) : ""}
            </Td>
          </tr>
          <tr>
            <Td className={cn(B, "h-[22px] font-bold")}>{LABELS.gstin}</Td>
            <Td colSpan={2} className={cn(B, "font-bold")} data-testid="paper-gstin">
              {c.gstin}
            </Td>
            <Td className={cn(B, "font-bold")}>{LABELS.email}</Td>
            <Td colSpan={L - 4} className={cn(B, "text-center")} data-testid="paper-email">
              {c.email}
            </Td>
          </tr>
          <tr>
            <Td colSpan={L} className={cn(B, "h-[22px] whitespace-pre font-bold")} data-testid="paper-contact">
              {`${LABELS.contact} : ${[c.contactPerson, c.contactPhone].filter(Boolean).join(" ")}`}
            </Td>
            <Td colSpan={3} className={B} />
          </tr>

          {/* Row 12 — spacer (holds the discount % marker above "Rate after Discount") */}
          <tr>
            {disc ? (
              <>
                <Td colSpan={radIndex} className="h-[11px] border-l border-black" />
                <Td
                  className="border-x border-t border-black text-center font-bold text-red-600"
                  style={{ background: "#FFFF00" }}
                  data-testid="paper-discount"
                >
                  {`${Number(view.discountPercent.toFixed(2))}%`}
                </Td>
                <Td colSpan={n - radIndex - 1} className="border-r border-black" />
              </>
            ) : (
              <Td colSpan={n} className="h-[11px] border-x border-black" />
            )}
          </tr>

          {/* Row 13 — column headings */}
          <tr>
            {cols.map((col) => (
              <Td
                key={col.key}
                className={cn(B, "h-[34px] text-center font-bold leading-[1.15]")}
                style={{ background: HEAD_FILL }}
              >
                {col.label}
              </Td>
            ))}
          </tr>

          {/* Rows 14+ — items */}
          {rows.map((r, i) => (
            <tr key={i} className="[break-inside:avoid]">
              {cols.map((col) => (
                <Td
                  key={col.key}
                  className={cn(
                    B,
                    "h-[19px] tabular-nums",
                    col.align === "right" && "text-right",
                    col.align === "center" && "text-center",
                    col.key === "part" && "text-[10px] leading-[1.1]",
                    col.key === "hsn" && "text-left",
                  )}
                  data-testid={col.key === "total" ? "paper-line-total" : undefined}
                >
                  {editable && r.productId && col.key === "qty" ? (
                    <input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={r.qty || ""}
                      placeholder="·"
                      aria-label={`Quantity for ${r.particulars.replace(/\s+/g, " ")}`}
                      data-testid="qty-input"
                      onChange={(e) => editable.onQty(r.productId!, Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                      className={cn(
                        "h-[17px] w-full rounded-sm border border-transparent bg-sky-50 text-center tabular-nums outline-none",
                        "hover:border-sky-400 focus:border-sky-600 focus:bg-white focus:ring-1 focus:ring-sky-600",
                        r.qty > 0 && "bg-emerald-50 font-bold",
                      )}
                    />
                  ) : editable?.canEditRate && r.productId && col.key === "rate" && r.qty > 0 ? (
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={r.rate}
                      aria-label={`Rate for ${r.particulars.replace(/\s+/g, " ")}`}
                      onChange={(e) => editable.onRate?.(r.productId!, Math.max(0, Number(e.target.value) || 0))}
                      className="h-[17px] w-full rounded-sm border border-amber-400 bg-amber-50 text-right tabular-nums outline-none"
                    />
                  ) : (
                    renderCell(col.key, r)
                  )}
                </Td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <Td colSpan={n} className={cn(B, "h-[42px] text-center italic text-neutral-500")}>
                No materials
              </Td>
            </tr>
          )}

          {/* Total row */}
          <tr>
            {cols.map((col) => (
              <Td
                key={col.key}
                className={cn(
                  B,
                  "h-[22px] font-bold tabular-nums",
                  col.key === "part" ? "text-center" : "text-right",
                )}
                style={{ background: HEAD_FILL }}
                data-testid={col.key === "total" ? "paper-grand-total" : undefined}
              >
                {totalCell(col.key)}
              </Td>
            ))}
          </tr>

          {/* Rounded off */}
          <tr>
            <Td colSpan={n - 4} className={B} />
            <Td colSpan={3} className={cn(B, "h-[23px] text-center font-bold")} style={{ background: HEAD_FILL }}>
              {LABELS.roundedOff}
            </Td>
            <Td className={cn(B, "text-right font-bold tabular-nums")} style={{ background: HEAD_FILL }} data-testid="paper-rounded">
              {money(t.roundedTotal)}
            </Td>
          </tr>

          {/* Amount in words | For MCCIA */}
          <tr>
            <Td colSpan={L} rowSpan={2} className={cn(B, "whitespace-pre-wrap align-top")} data-testid="paper-words">
              {`${LABELS.amountInWords} : ${words}${words ? " " : ""}`}
            </Td>
            <Td colSpan={3} className={cn(B, "h-[21px] text-center font-bold")}>
              {header.forOrg}
            </Td>
          </tr>
          {/* Branch seal area */}
          <tr>
            <Td colSpan={3} rowSpan={3} className={B}>
              {SIGNATORY.enabled && (
                <div className="flex h-[66px] items-center justify-center">
                  {/* Round seal of the branch that issued the invoice: fixed, chosen from the invoice number. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={sealFor(view.invoiceNumber)}
                    alt="Branch seal"
                    data-testid="branch-seal"
                    width={64}
                    height={64}
                    className="h-[62px] w-[62px] object-contain"
                    onError={(e) => {
                      if (!e.currentTarget.src.endsWith(SIGNATORY.stampSrc)) e.currentTarget.src = SIGNATORY.stampSrc; // seal file missing
                    }}
                  />
                </div>
              )}
            </Td>
          </tr>
          {/* Payment details */}
          <tr>
            <Td
              colSpan={L}
              rowSpan={3}
              className={cn(B, "whitespace-pre-wrap align-top text-[11.5px]")}
              style={{ background: HEAD_FILL }}
              data-testid="paper-payment"
            >
              {`${LABELS.paymentDetails} : ${paymentText(view.payments, view.paymentSummary, view.paymentDetails)}`}
            </Td>
          </tr>
          <tr />
          <tr>
            <Td colSpan={3} className={cn(B, "h-[22px] text-center font-bold")}>
              {header.signatory}
            </Td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * Scales the fixed-size A4 sheet to fit its container (down always, up to `maxScale`), keeping
 * true print proportions on any screen width. Print CSS removes the transform.
 */
export function PaperFrame({ children, maxScale = 1 }: { children: ReactNode; maxScale?: number }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState(0); // centres the sheet when it is narrower than the frame
  const [height, setHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    const frame = frameRef.current;
    const inner = innerRef.current;
    if (!frame || !inner) return;
    const measure = () => {
      const s = Math.min(maxScale, frame.clientWidth / PAPER_WIDTH);
      setScale(s);
      setOffset(Math.max(0, (frame.clientWidth - PAPER_WIDTH * s) / 2));
      setHeight(inner.offsetHeight * s);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(frame);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [maxScale]);

  return (
    <div ref={frameRef} className="paper-frame w-full overflow-hidden" style={{ height }}>
      <div
        ref={innerRef}
        className="paper-scale origin-top-left"
        style={{ width: PAPER_WIDTH, marginLeft: offset, transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}
