import { z } from "zod";
import { computeView, type InvoiceDraft } from "./model";

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const customer = z.object({
  companyName: z.string().trim().min(1, "Company name is required"),
  gstin: z
    .string()
    .trim()
    .refine((v) => v === "" || GSTIN_RE.test(v.toUpperCase()), "Enter a valid 15-character GSTIN"),
  email: z
    .string()
    .trim()
    .refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid e-mail address"),
});

const draftSchema = z.object({
  customer,
  discountPercent: z.number().min(0, "Cannot be negative").max(100, "Cannot exceed 100"),
});

const submitSchema = draftSchema.extend({
  invoiceDate: z.string().min(1, "Invoice date is required"),
  items: z
    .array(
      z.object({
        productId: z.string().nullable().refine((v) => v !== null, "Choose a material"),
        rate: z.number().min(0, "Rate cannot be negative"),
        quantity: z.number().int("Whole numbers only").min(0, "Cannot be negative"),
      }),
    )
    .refine((items) => items.some((i) => i.quantity > 0), "Add at least one material with a quantity"),
});

export type ValidationMode = "draft" | "submit";
export type FieldErrors = Record<string, string>;

/** Shared by the editor (instant feedback) and the mock server (authoritative check). */
export function validateDraft(draft: InvoiceDraft, mode: ValidationMode): FieldErrors {
  const schema = mode === "submit" ? submitSchema : draftSchema;
  const result = schema.safeParse(draft);
  const errors: FieldErrors = {};
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = issue.path.join(".");
      if (!(key in errors)) errors[key] = issue.message;
    }
  }
  // Payments (same rules as the server): each leg has an amount, "Other" says what it is, and together
  // they never exceed the payable total. Paying less is allowed: it is a part payment with a balance due.
  const payableP = Math.round(computeView(draft).totals.roundedTotal * 100);
  let paidP = 0;
  draft.payments.forEach((p, i) => {
    const amountP = Math.round(p.amount * 100);
    if (!(p.amount > 0)) errors[`payments.${i}.amount`] = "Enter the amount";
    else if (Math.abs(amountP - p.amount * 100) > 1e-6) errors[`payments.${i}.amount`] = "Use at most 2 decimals";
    paidP += Number.isFinite(amountP) ? amountP : 0;
    if (p.mode === "OTHER" && !p.reference.trim()) errors[`payments.${i}.reference`] = "Say how it was paid";
  });
  if (paidP > payableP) errors["payments"] = "The payments add up to more than the invoice total";

  // Changing a submitted invoice creates a new version, so a reason is required (the server enforces it too).
  if (mode === "submit" && draft.status && draft.status !== "DRAFT" && draft.editReason.trim().length < 3)
    errors["editReason"] = "Give a reason for the change";
  return errors;
}

export class ValidationError extends Error {
  constructor(public readonly errors: FieldErrors) {
    super("Please fix the highlighted fields.");
    this.name = "ValidationError";
  }
}
