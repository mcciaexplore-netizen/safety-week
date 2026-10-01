import { EVENT } from "@/lib/config/app-config";
import { draftToInvoice } from "@/lib/invoice/model";
import { validateDraft, ValidationError } from "@/lib/invoice/validation";
import { BRANCHES } from "@/lib/mock/branches";
import { PRODUCTS } from "@/lib/mock/products";
import { DEMO_USERS, seedInvoices } from "@/lib/mock/seed";
import type { Invoice, InvoiceStatus } from "@/lib/types";
import { getSession, setSession } from "./session-store";
import { summarize } from "./summarize";
import { AuthError, NotFoundError, type Services, type Session } from "./types";

const delay = (ms = 350) => new Promise((r) => setTimeout(r, ms));

/* ---------- invoice store (localStorage-backed, seeded) ---------- */

const STORE_KEY = "nsw27.mock.invoices.v2"; // v2: demo invoices now carry payments
let cache: Invoice[] | null = null;

function persist() {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

function loadAll(): Invoice[] {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw) {
      cache = JSON.parse(raw) as Invoice[];
      return cache;
    }
  } catch {
    /* fall through to seed */
  }
  cache = seedInvoices();
  persist();
  return cache;
}

/** Every read is scoped to the signed-in branch: the rule a real server enforces. */
function requireSession(): Session {
  const s = getSession();
  if (!s) throw new AuthError("Your session has expired. Please sign in again.");
  return s;
}

function branchInvoices(): Invoice[] {
  const s = requireSession();
  return loadAll().filter((i) => i.branchId === s.branch.id);
}

/** Mock only: the real sequence must be allocated by the database (PLAN §12). */
function nextNumber(branchCode: string, mine: Invoice[]) {
  const next = mine.reduce((m, i) => Math.max(m, Number(i.invoiceNumber.split("-")[2])), 0) + 1;
  const seq = String(next).padStart(6, "0");
  return {
    id: `inv-${branchCode.toLowerCase()}-${seq}`,
    number: `${EVENT.invoicePrefix}-${branchCode}-${seq}`,
  };
}

/* ---------- services ---------- */

export const mockServices: Services = {
  auth: {
    async signIn({ branchId, email, password }) {
      await delay(600);
      const branch = BRANCHES.find((b) => b.id === branchId);
      if (!branch) throw new AuthError("Unknown branch.");
      if (!email.trim()) throw new AuthError("Enter your user ID or e-mail.");
      if (password.length < 4)
        throw new AuthError("Password must be at least 4 characters (demo).");
      const user = { ...DEMO_USERS[branchId], email: email.trim() };
      const session: Session = { user, branch, signedInAt: new Date().toISOString() };
      setSession(session);
      return session;
    },
    async signOut() {
      setSession(null);
    },
  },

  branches: {
    async list() {
      await delay(250);
      return BRANCHES.filter((b) => b.active);
    },
    async getByCode(code) {
      return BRANCHES.find((b) => b.code === code.toUpperCase()) ?? null;
    },
    demoLoginEmail(branchId) {
      return DEMO_USERS[branchId]?.email ?? "";
    },
  },

  catalog: {
    async getEvent() {
      return EVENT;
    },
    async listProducts() {
      await delay(200);
      return PRODUCTS;
    },
  },

  invoices: {
    async list(filter) {
      await delay(400);
      const q = filter?.query?.trim().toLowerCase();
      return branchInvoices()
        .filter((i) => !filter?.status || filter.status === "ALL" || i.status === filter.status)
        .filter((i) => !filter?.from || i.invoiceDate.slice(0, 10) >= filter.from)
        .filter((i) => !filter?.to || i.invoiceDate.slice(0, 10) <= filter.to)
        .filter(
          (i) =>
            !q ||
            i.invoiceNumber.toLowerCase().includes(q) ||
            i.customer.companyName.toLowerCase().includes(q),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async get(id) {
      await delay(300);
      const inv = branchInvoices().find((i) => i.id === id);
      if (!inv) throw new NotFoundError("Invoice");
      return inv;
    },
    async downloadPdf(inv) {
      window.open(`/invoices/${inv.id}?print=1`, "_blank"); // demo: the browser print dialog (Save as PDF)
    },
    async peekNextNumber() {
      const s = requireSession();
      return nextNumber(s.branch.code, loadAll().filter((i) => i.branchId === s.branch.id)).number;
    },
    async save({ draft, action }) {
      await delay(500);
      const s = requireSession();
      const errors = validateDraft(draft, action === "submit" ? "submit" : "draft");
      if (Object.keys(errors).length) throw new ValidationError(errors);
      const all = loadAll();
      const mine = all.filter((i) => i.branchId === s.branch.id);
      const existing = draft.id ? mine.find((i) => i.id === draft.id) : undefined;
      if (draft.id && !existing) throw new NotFoundError("Invoice");
      if (existing?.status === "CANCELLED")
        throw new Error("Cancelled invoices cannot be edited.");

      let status: InvoiceStatus;
      let version = 1;
      if (existing && existing.status !== "DRAFT") {
        status = "EDITED"; // revising a submitted invoice keeps history via version++
        version = existing.version + 1;
      } else {
        status = action === "submit" ? "SUBMITTED" : "DRAFT";
        version = existing?.version ?? 1;
      }

      const num = existing
        ? { id: existing.id, number: existing.invoiceNumber }
        : nextNumber(s.branch.code, mine);
      const invoice = draftToInvoice(draft, {
        id: num.id,
        invoiceNumber: num.number,
        branchId: s.branch.id, // taken from the session, never from the payload
        status,
        version,
        createdBy: existing?.createdBy ?? s.user.name,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      });
      if (existing) all[all.indexOf(existing)] = invoice;
      else all.push(invoice);
      persist();
      return invoice;
    },
  },

  // ponytail: version history, cancellation and the audit log only mean something with the live backend.
  admin: {
    async listVersions() {
      return [];
    },
    async getVersion() {
      throw new NotFoundError("Version");
    },
    async cancelInvoice() {
      throw new Error("Cancelling invoices needs the live backend.");
    },
    async listAudit() {
      return [];
    },
  },

  dashboard: {
    async getSummary() {
      await delay(500);
      return summarize(branchInvoices());
    },
  },
};
