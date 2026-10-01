import type { InvoiceDraft } from "@/lib/invoice/model";
import type { EventConfig, Invoice, InvoiceStatus, PaymentMode, Product } from "@/lib/types";
import { getSession, setSession } from "./session-store";
import { summarize } from "./summarize";
import { AuthError, NotFoundError, type Services } from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

/** Calls the FastAPI backend with the signed-in user's bearer token. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getSession()?.accessToken;
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.ok) return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  if (res.status === 401) {
    setSession(null); // expired or invalid token: back to sign-in via the workspace guard
    throw new AuthError("Your session has expired. Please sign in again.");
  }
  const detail = ((await res.json().catch(() => null)) as { detail?: unknown } | null)?.detail;
  const message =
    typeof detail === "string"
      ? detail
      : Array.isArray(detail)
        ? detail.map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).slice(1).join(".")}: ${d.msg}`).join("; ")
        : "Please check the form and try again.";
  if (res.status === 404 && path.startsWith("/invoices")) throw new NotFoundError("Invoice");
  if (res.status === 204) return undefined as T;
  throw new Error(message);
}

/* ---------- API wire format -> UI types (decimals arrive as strings) ---------- */

interface ApiItem {
  id: string; product_id: string | null; particulars: string; hsn_code: string; rate: string;
  quantity: number; discount_percent: string; rate_after_discount: string; basic_amount: string;
  cgst_rate: string; cgst_amount: string; sgst_rate: string; sgst_amount: string;
  total_amount: string; line_order: number;
}
interface ApiInvoice {
  id: string; invoice_number: string; branch_id: string; event_id: string; status: InvoiceStatus;
  created_by_name: string; company_name: string; address: string; gstin: string; email: string;
  contact_person: string; contact_phone: string; invoice_date: string; subtotal: string;
  cgst_total: string; sgst_total: string; rounding_adjustment: string; grand_total: string;
  amount_in_words: string; payment_details: string; payments?: { mode: PaymentMode; amount: string; reference: string }[]; version: number; created_at: string;
  updated_at: string; items: ApiItem[];
}

const num = (v: string | number) => Number(v);

export function toInvoice(a: ApiInvoice): Invoice {
  const rounded = num(a.grand_total);
  return {
    id: a.id,
    invoiceNumber: a.invoice_number,
    eventId: a.event_id,
    branchId: a.branch_id,
    status: a.status,
    invoiceDate: `${a.invoice_date}T00:00:00.000Z`,
    customer: {
      companyName: a.company_name, address: a.address, gstin: a.gstin, email: a.email,
      contactPerson: a.contact_person, contactPhone: a.contact_phone,
    },
    items: a.items.map((i) => ({
      id: i.id, productId: i.product_id, particulars: i.particulars, hsnCode: i.hsn_code,
      rate: num(i.rate), quantity: i.quantity, discountPercent: num(i.discount_percent),
      rateAfterDiscount: num(i.rate_after_discount), basicAmount: num(i.basic_amount),
      cgstRate: num(i.cgst_rate), cgstAmount: num(i.cgst_amount), sgstRate: num(i.sgst_rate),
      sgstAmount: num(i.sgst_amount), totalAmount: num(i.total_amount), lineOrder: i.line_order,
    })),
    totals: {
      totalQuantity: a.items.reduce((s, i) => s + i.quantity, 0),
      basicTotal: num(a.subtotal),
      cgstTotal: num(a.cgst_total),
      sgstTotal: num(a.sgst_total),
      grandTotal: rounded - num(a.rounding_adjustment),
      roundingAdjustment: num(a.rounding_adjustment),
      roundedTotal: rounded,
    },
    amountInWords: a.amount_in_words,
    paymentDetails: a.payment_details,
    payments: (a.payments ?? []).map((p) => ({ mode: p.mode, amount: num(p.amount), reference: p.reference })),
    version: a.version,
    createdBy: a.created_by_name,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
  };
}

/** The browser sends only what the user typed. Totals, tax, HSN and numbering are the server's job. */
function toPayload(draft: InvoiceDraft, action: "draft" | "submit") {
  const c = draft.customer;
  return {
    company_name: c.companyName, address: c.address, gstin: c.gstin, email: c.email,
    contact_person: c.contactPerson, contact_phone: c.contactPhone,
    invoice_date: draft.invoiceDate,
    discount_percent: draft.discountPercent,
    items: draft.items
      .filter((i) => i.productId) // an empty "Choose material…" row is not a line
      .map((i) => ({ product_id: i.productId, quantity: i.quantity, rate: i.rate })),
    amount_in_words: draft.amountInWordsOverride?.trim() || null,
    payment_details: draft.paymentDetails,
    payments: draft.payments.map((p) => ({ mode: p.mode, amount: p.amount.toFixed(2), reference: p.reference.trim() })),
    action,
  };
}

/** Saves a file the API returns (Excel, PDF) through the browser's normal download. */
export async function downloadFromApi(path: string, fallbackName: string): Promise<void> {
  const token = getSession()?.accessToken;
  const res = await fetch(`${API_URL}/api/v1${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    if (res.status === 401) setSession(null);
    const detail = ((await res.json().catch(() => null)) as { detail?: unknown } | null)?.detail;
    throw new Error(typeof detail === "string" ? detail : "Could not download the file.");
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

export const apiServices: Pick<Services, "catalog" | "invoices" | "dashboard" | "admin"> = {
  catalog: {
    async getEvent() {
      const e = await api<{ id: string; name: string; year: number; invoice_prefix: string;
        start_date: string | null; end_date: string | null; status: EventConfig["status"] }>("/events/current");
      return { id: e.id, name: e.name, year: e.year, startDate: e.start_date, endDate: e.end_date,
        status: e.status, invoicePrefix: e.invoice_prefix };
    },
    async listProducts() {
      const rows = await api<{ id: string; sku: string; name: string; hsn_code: string; unit: string;
        current_rate: string; cgst_rate: string; sr_no: number | null; line_order: number }[]>("/products");
      return rows.map((p): Product => ({
        id: p.id, sku: p.sku, name: p.name, hsnCode: p.hsn_code, unit: p.unit,
        currentRate: num(p.current_rate), gstHalfRate: num(p.cgst_rate), srNo: p.sr_no,
        lineOrder: p.line_order, active: true,
      }));
    },
  },

  invoices: {
    async list(filter) {
      const q = new URLSearchParams({ limit: "500" });
      if (filter?.query?.trim()) q.set("q", filter.query.trim());
      if (filter?.status && filter.status !== "ALL") q.set("status", filter.status);
      if (filter?.from) q.set("date_from", filter.from);
      if (filter?.to) q.set("date_to", filter.to);
      return (await api<ApiInvoice[]>(`/invoices?${q}`)).map(toInvoice);
    },
    async get(id) {
      return toInvoice(await api<ApiInvoice>(`/invoices/${encodeURIComponent(id)}`));
    },
    async downloadPdf(inv, version) {
      const token = getSession()?.accessToken;
      const q = version ? `?version=${version}` : "";
      const res = await fetch(`${API_URL}/api/v1/invoices/${encodeURIComponent(inv.id)}/document${q}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        if (res.status === 401) setSession(null);
        const detail = ((await res.json().catch(() => null)) as { detail?: unknown } | null)?.detail;
        throw new Error(typeof detail === "string" ? detail : "Could not download the PDF.");
      }
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement("a"), { href: url, download: version ? `${inv.invoiceNumber}_v${version}.pdf` : `${inv.invoiceNumber}.pdf` });
      a.click();
      URL.revokeObjectURL(url);
    },
    async peekNextNumber() {
      return (await api<{ invoice_number: string }>("/invoices/next-number")).invoice_number;
    },
    async save({ draft, action }) {
      const body = JSON.stringify({ ...toPayload(draft, action), ...(draft.id ? { edit_reason: draft.editReason.trim() } : {}) });
      const saved = draft.id
        ? await api<ApiInvoice>(`/invoices/${draft.id}`, { method: "PUT", body })
        : await api<ApiInvoice>("/invoices", { method: "POST", body });
      return toInvoice(saved);
    },
  },

  dashboard: {
    // Computed from the branch's invoices (the API already scopes them to the caller's branch).
    async getSummary() {
      return summarize((await api<ApiInvoice[]>("/invoices?limit=500")).map(toInvoice));
    },
  },

  admin: {
    async listVersions(invoiceId) {
      const rows = await api<{ version_number: number; created_at: string; edited_by_name: string;
        edit_reason: string; status: InvoiceStatus; grand_total: string }[]>(`/invoices/${invoiceId}/versions`);
      return rows.map((v) => ({ versionNumber: v.version_number, createdAt: v.created_at, editedBy: v.edited_by_name,
        editReason: v.edit_reason, status: v.status, grandTotal: num(v.grand_total) }));
    },
    async getVersion(invoiceId, n) {
      return toInvoice(await api<ApiInvoice>(`/invoices/${invoiceId}/versions/${n}`));
    },
    async cancelInvoice(invoiceId, reason) {
      return toInvoice(await api<ApiInvoice>(`/invoices/${invoiceId}/cancel`, {
        method: "POST", body: JSON.stringify({ reason }) }));
    },
    async listAudit(filter) {
      const q = new URLSearchParams({ limit: "200" });
      if (filter?.action) q.set("action", filter.action);
      const rows = await api<{ id: string; created_at: string; actor_name: string; branch_id: string | null;
        action: string; entity_type: string; entity_id: string | null; metadata: Record<string, unknown> }[]>(`/audit-logs?${q}`);
      return rows.map((r) => ({ id: r.id, createdAt: r.created_at, actor: r.actor_name, branchId: r.branch_id,
        action: r.action, entityType: r.entity_type, entityId: r.entity_id, metadata: r.metadata }));
    },
  },
};
