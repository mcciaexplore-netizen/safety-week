import type { InvoiceDraft } from "@/lib/invoice/model";
import type {
  Branch,
  DashboardSummary,
  EventConfig,
  Invoice,
  InvoiceListFilter,
  InvoiceStatus,
  Product,
  SessionUser,
} from "@/lib/types";

/**
 * Service boundaries. The UI depends ONLY on these interfaces; the mock
 * implementations in ./mock can be swapped for FastAPI/Supabase clients.
 *
 * No invoice method accepts a branch id. The branch is resolved from the
 * authenticated identity (PLAN §26.11): in the mock it comes from the mock
 * session, in production from the server-side token.
 */

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} was not found.`);
    this.name = "NotFoundError";
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export interface Session {
  user: SessionUser;
  branch: Branch;
  signedInAt: string;
  /** Supabase access token (real auth only). Phase 6 sends it as the API bearer token. */
  accessToken?: string;
}

export interface AuthService {
  signIn(input: { branchId: string; email: string; password: string }): Promise<Session>;
  signOut(): Promise<void>;
}

export interface BranchService {
  list(): Promise<Branch[]>;
  getByCode(code: string): Promise<Branch | null>;
  /** Demo convenience: prefilled login e-mail for a branch. */
  demoLoginEmail(branchId: string): string;
}

export interface CatalogService {
  getEvent(): Promise<EventConfig>;
  listProducts(): Promise<Product[]>;
}

export type SaveAction = "draft" | "submit";

export interface InvoiceService {
  list(filter?: InvoiceListFilter): Promise<Invoice[]>;
  get(id: string): Promise<Invoice>;
  /** Provisional next invoice number for the signed-in branch (final number is assigned on first save). */
  peekNextNumber(): Promise<string>;
  /**
   * Creates or updates an invoice. The server recalculates every amount from the
   * draft and validates it; the client-side totals are only optimistic (PLAN §11).
   * Throws ValidationError, NotFoundError or AuthError.
   */
  save(input: { draft: InvoiceDraft; action: SaveAction }): Promise<Invoice>;
  /** Downloads the invoice PDF (API: the stored PDF; demo: the browser print dialog). */
  downloadPdf(invoice: { id: string; invoiceNumber: string }, version?: number): Promise<void>;
}

export interface DashboardService {
  getSummary(): Promise<DashboardSummary>;
}

export interface VersionInfo {
  versionNumber: number;
  createdAt: string;
  editedBy: string;
  editReason: string;
  status: InvoiceStatus;
  grandTotal: number;
}

export interface AuditEntry {
  id: string;
  createdAt: string;
  actor: string;
  branchId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
}

/** Admin-only views. Real data exists only with the live backend (demo mode returns nothing). */
export interface AdminService {
  listVersions(invoiceId: string): Promise<VersionInfo[]>;
  getVersion(invoiceId: string, versionNumber: number): Promise<Invoice>;
  cancelInvoice(invoiceId: string, reason: string): Promise<Invoice>;
  listAudit(filter?: { action?: string }): Promise<AuditEntry[]>;
}

export interface Services {
  auth: AuthService;
  branches: BranchService;
  catalog: CatalogService;
  invoices: InvoiceService;
  dashboard: DashboardService;
  admin: AdminService;
}
