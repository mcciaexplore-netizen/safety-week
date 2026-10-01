/**
 * Domain types. These mirror the conceptual schema in PLAN.md §15 so the mock
 * services can later be replaced by FastAPI/Supabase without touching the UI.
 */

export type BranchCode = "SBR" | "TIL" | "BHO" | "HAD" | "AHL";

export interface Branch {
  id: string;
  code: BranchCode;
  name: string;
  address: string;
  phone: string;
  email: string;
  active: boolean;
}

export type UserRole = "SUPER_ADMIN" | "BRANCH_ADMIN" | "BRANCH_USER";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  branchId: string;
}

export interface EventConfig {
  id: string;
  name: string;
  year: number;
  /** ISO dates; null until MCCIA confirms the 2027 schedule. */
  startDate: string | null;
  endDate: string | null;
  status: "PLANNING" | "OPEN" | "CLOSED";
  invoicePrefix: string;
}

/** Issuer block printed on every invoice (docs/invoice-spec.md §1). */
export interface OrganisationProfile {
  title: string;
  name: string;
  addressLines: string[];
  stateCode: string;
  phone: string;
  email: string;
  gstin: string;
  pan: string;
}

export interface Product {
  id: string;
  sku: string;
  /** Exact `Particulars` text from the source workbook. */
  name: string;
  hsnCode: string;
  unit: string;
  /** Reference rate. 2026 workbook value until 2027 pricing is configured. */
  currentRate: number;
  /** CGST rate == SGST rate, in percent (9 or 2.5). */
  gstHalfRate: number;
  /** Workbook `Sr.`; null for variant rows that carry a blank Sr. */
  srNo: number | null;
  lineOrder: number;
  active: boolean;
}

export type InvoiceStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "GENERATED"
  | "EDITED"
  | "CANCELLED";

export interface InvoiceItem {
  id: string;
  productId: string | null;
  particulars: string;
  hsnCode: string;
  rate: number;
  quantity: number;
  /** Percentage discount applied to the rate before tax (variant B), 0 if none. */
  discountPercent: number;
  rateAfterDiscount: number;
  basicAmount: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  totalAmount: number;
  lineOrder: number;
}

export interface InvoiceCustomer {
  companyName: string;
  address: string;
  gstin: string;
  email: string;
  contactPerson: string;
  contactPhone: string;
}

export interface InvoiceTotals {
  totalQuantity: number;
  basicTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  grandTotal: number;
  roundingAdjustment: number;
  roundedTotal: number;
}

export type PaymentMode = "CASH" | "UPI" | "CARD" | "NET_BANKING" | "OTHER";
export type PaymentStatus = "UNPAID" | "PARTIAL" | "PAID";

/** One leg of a payment. A split payment is several of these (e.g. UPI 2000 + Cash 1938). */
export interface InvoicePayment {
  mode: PaymentMode;
  amount: number;
  reference: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  eventId: string;
  branchId: string;
  status: InvoiceStatus;
  invoiceDate: string;
  customer: InvoiceCustomer;
  items: InvoiceItem[];
  totals: InvoiceTotals;
  amountInWords: string;
  paymentDetails: string;
  payments: InvoicePayment[];
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceListFilter {
  query?: string;
  status?: InvoiceStatus | "ALL";
  /** Inclusive yyyy-mm-dd bounds on the invoice date. */
  from?: string;
  to?: string;
}

export interface DashboardSummary {
  invoiceCount: number;
  draftCount: number;
  submittedCount: number;
  totalValue: number;
  averageValue: number;
  unitsSold: number;
  statusBreakdown: { status: InvoiceStatus; count: number }[];
  topProducts: { name: string; quantity: number; value: number }[];
  monthly: { label: string; value: number }[];
  recent: Invoice[];
}
