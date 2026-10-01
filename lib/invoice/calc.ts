import type { InvoiceItem, InvoiceTotals } from "@/lib/types";

/**
 * Centralised invoice arithmetic, mirroring the workbook formulas
 * (docs/invoice-spec.md §5). No per-line rounding: only the grand total is
 * rounded, to the nearest rupee. Half-up at .50 is an ASSUMPTION (spec Q5).
 */

export interface LineInput {
  rate: number;
  quantity: number;
  /** Percent taken off the unit rate BEFORE tax. 0 = no discount. */
  discountPercent: number;
  /** CGST and SGST are equal in the workbook; kept separate for the data model. */
  cgstRate: number;
  sgstRate: number;
}

export interface LineResult {
  rateAfterDiscount: number;
  basicAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  totalAmount: number;
}

export function computeLine(input: LineInput): LineResult {
  const { rate, quantity, discountPercent, cgstRate, sgstRate } = input;
  const rateAfterDiscount = rate - (rate * discountPercent) / 100;
  const basicAmount = quantity * rateAfterDiscount;
  const cgstAmount = (basicAmount * cgstRate) / 100;
  const sgstAmount = (basicAmount * sgstRate) / 100;
  return {
    rateAfterDiscount,
    basicAmount,
    cgstAmount,
    sgstAmount,
    totalAmount: basicAmount + cgstAmount + sgstAmount,
  };
}

type TotalsLine = Pick<
  InvoiceItem,
  "quantity" | "basicAmount" | "cgstAmount" | "sgstAmount" | "totalAmount"
>;

export function computeTotals(items: TotalsLine[]): InvoiceTotals {
  const sum = (pick: (i: TotalsLine) => number) =>
    items.reduce((acc, i) => acc + pick(i), 0);
  const grandTotal = sum((i) => i.totalAmount);
  const roundedTotal = Math.round(Number(grandTotal.toFixed(6)));
  return {
    totalQuantity: sum((i) => i.quantity),
    basicTotal: sum((i) => i.basicAmount),
    cgstTotal: sum((i) => i.cgstAmount),
    sgstTotal: sum((i) => i.sgstAmount),
    grandTotal,
    roundedTotal,
    roundingAdjustment: roundedTotal - grandTotal,
  };
}
