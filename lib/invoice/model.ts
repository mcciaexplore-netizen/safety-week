import { EVENT } from "@/lib/config/app-config";
import type {
  Invoice,
  InvoiceCustomer,
  InvoiceItem,
  InvoiceStatus,
  InvoiceTotals,
  Product,
} from "@/lib/types";
import { computeLine, computeTotals } from "./calc";
import { amountInWords } from "./words";
import { summarizePayments, type PaymentSummary } from "./payments";
import type { PaymentMode } from "@/lib/types";

/**
 * The single typed invoice model behind the editor. The form edits it and the
 * paper preview is rendered from `computeView(draft)`. There is no second copy.
 */

export interface DraftItem {
  /** Stable React key / line id. */
  key: string;
  productId: string | null;
  particulars: string;
  hsnCode: string;
  rate: number;
  quantity: number;
  /** CGST rate == SGST rate, percent (9 or 2.5 in the source). */
  gstHalfRate: number;
}

export interface DraftPayment {
  key: string;
  mode: PaymentMode;
  amount: number;
  reference: string;
}

export interface InvoiceDraft {
  /** null until first saved. */
  id: string | null;
  invoiceNumber: string;
  status: InvoiceStatus | null;
  version: number;
  /** yyyy-mm-dd */
  invoiceDate: string;
  customer: InvoiceCustomer;
  items: DraftItem[];
  /** Percent off each rate BEFORE tax; 0 = none (spec §5.3). */
  discountPercent: number;
  /** null = auto-generated from the rounded total. */
  amountInWordsOverride: string | null;
  /** Free-text notes, printed after the payment modes. */
  paymentDetails: string;
  /** Mode(s) of payment. Empty = not paid yet. */
  payments: DraftPayment[];
  /** false = one mode that always covers the full payable amount; true = the user enters each amount (split / part payment). */
  splitPayment: boolean;
  /** Why a submitted invoice is being changed (required for revisions; kept with the version). */
  editReason: string;
}

/** Everything the paper needs to render; derived, never edited. */
export interface InvoiceView {
  invoiceNumber: string;
  invoiceDate: string;
  customer: InvoiceCustomer;
  lines: InvoiceItem[];
  totals: InvoiceTotals;
  amountInWords: string;
  paymentDetails: string;
  payments: DraftPayment[];
  paymentSummary: PaymentSummary;
  discountPercent: number;
}

let keyCounter = 0;
export const newKey = () => `ln-${Date.now().toString(36)}-${keyCounter++}`;

export function todayLocalIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const EMPTY_CUSTOMER: InvoiceCustomer = {
  companyName: "",
  address: "",
  gstin: "",
  email: "",
  contactPerson: "",
  contactPhone: "",
};

export function emptyDraft(invoiceNumber: string): InvoiceDraft {
  return {
    id: null,
    invoiceNumber,
    status: null,
    version: 1,
    invoiceDate: todayLocalIso(),
    customer: { ...EMPTY_CUSTOMER },
    items: [],
    discountPercent: 0,
    amountInWordsOverride: null,
    paymentDetails: "",
    payments: [],
    splitPayment: false,
    editReason: "",
  };
}

export function itemFromProduct(product: Product, key = newKey()): DraftItem {
  return {
    key,
    productId: product.id,
    particulars: product.name,
    hsnCode: product.hsnCode,
    rate: product.currentRate,
    quantity: 0,
    gstHalfRate: product.gstHalfRate,
  };
}

export function blankItem(): DraftItem {
  return {
    key: newKey(),
    productId: null,
    particulars: "",
    hsnCode: "",
    rate: 0,
    quantity: 0,
    gstHalfRate: 0,
  };
}

export function invoiceToDraft(inv: Invoice): InvoiceDraft {
  const generated = amountInWords(inv.totals.roundedTotal);
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    status: inv.status,
    version: inv.version,
    invoiceDate: inv.invoiceDate.slice(0, 10),
    customer: { ...inv.customer },
    items: inv.items.map((it) => ({
      key: it.id,
      productId: it.productId,
      particulars: it.particulars,
      hsnCode: it.hsnCode,
      rate: it.rate,
      quantity: it.quantity,
      gstHalfRate: it.cgstRate,
    })),
    discountPercent: inv.items[0]?.discountPercent ?? 0,
    amountInWordsOverride: inv.amountInWords !== generated ? inv.amountInWords : null,
    paymentDetails: inv.paymentDetails,
    payments: (inv.payments ?? []).map((p) => ({ key: newKey(), ...p })),
    // one payment covering everything is the simple case; anything else is shown as a split / part payment
    splitPayment:
      (inv.payments ?? []).length > 1 || ((inv.payments ?? []).length === 1 && inv.payments[0].amount !== inv.totals.roundedTotal),
    editReason: "",
  };
}

/** In the simple (non-split) case the single payment always equals the payable amount, whatever the items are. */
export function withSyncedPayment(draft: InvoiceDraft): InvoiceDraft {
  if (draft.splitPayment || draft.payments.length !== 1) return draft;
  const payable = computeView({ ...draft, payments: [] }).totals.roundedTotal;
  return draft.payments[0].amount === payable ? draft : { ...draft, payments: [{ ...draft.payments[0], amount: payable }] };
}

/** Single derivation used by the preview, the form summary and the (mock) server. */
export function computeView(draft: InvoiceDraft): InvoiceView {
  const lines: InvoiceItem[] = draft.items.map((it, i) => {
    const calc = computeLine({
      rate: it.rate,
      quantity: it.quantity,
      discountPercent: draft.discountPercent,
      cgstRate: it.gstHalfRate,
      sgstRate: it.gstHalfRate,
    });
    return {
      id: it.key,
      productId: it.productId,
      particulars: it.particulars,
      hsnCode: it.hsnCode,
      rate: it.rate,
      quantity: it.quantity,
      discountPercent: draft.discountPercent,
      rateAfterDiscount: calc.rateAfterDiscount,
      basicAmount: calc.basicAmount,
      cgstRate: it.gstHalfRate,
      cgstAmount: calc.cgstAmount,
      sgstRate: it.gstHalfRate,
      sgstAmount: calc.sgstAmount,
      totalAmount: calc.totalAmount,
      lineOrder: i + 1,
    };
  });
  const totals = computeTotals(lines);
  const override = draft.amountInWordsOverride?.trim();
  return {
    invoiceNumber: draft.invoiceNumber,
    invoiceDate: draft.invoiceDate,
    customer: draft.customer,
    lines,
    totals,
    amountInWords: override ? override : amountInWords(totals.roundedTotal),
    paymentDetails: draft.paymentDetails,
    payments: draft.payments,
    paymentSummary: summarizePayments(draft.payments, totals.roundedTotal),
    discountPercent: draft.discountPercent,
  };
}

export function invoiceToView(inv: Invoice): InvoiceView {
  return computeView(invoiceToDraft(inv));
}

/** Builds the persisted invoice. Used by the mock service exactly as a real server would. */
export function draftToInvoice(
  draft: InvoiceDraft,
  ctx: {
    id: string;
    invoiceNumber: string;
    branchId: string;
    status: InvoiceStatus;
    version: number;
    createdBy: string;
    createdAt: string;
  },
): Invoice {
  const view = computeView(draft);
  const now = new Date().toISOString();
  return {
    id: ctx.id,
    invoiceNumber: ctx.invoiceNumber,
    eventId: EVENT.id,
    branchId: ctx.branchId,
    status: ctx.status,
    invoiceDate: `${draft.invoiceDate}T00:00:00.000Z`,
    customer: { ...draft.customer },
    items: view.lines,
    totals: view.totals,
    amountInWords: view.amountInWords,
    paymentDetails: draft.paymentDetails,
    payments: draft.payments.map(({ mode, amount, reference }) => ({ mode, amount, reference })),
    version: ctx.version,
    createdBy: ctx.createdBy,
    createdAt: ctx.createdAt,
    updatedAt: now,
  };
}
