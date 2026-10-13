import { formatRupees } from "@/lib/format";

type Meta = Record<string, unknown>;
export interface AuditDescription {
  /** What happened, in one sentence. */
  title: string;
  /** The specifics, one per line (changed fields, materials and quantities...). */
  lines: string[];
}

const LABELS: Record<string, string> = {
  opening_qty: "Opening stock", low_threshold: "Low-stock level", current_rate: "Rate", rate_confirmed: "Rate confirmed",
  name: "Name", description: "Description", hsn_code: "HSN code", unit: "Unit", sku: "Product code",
  cgst_rate: "CGST %", sgst_rate: "SGST %", active: "Active", role: "Role", email: "E-mail", phone: "Phone",
  branch_id: "Branch", product_id: "Product", online_enabled: "Shown in online store", best_seller: "Best seller",
  category: "Category", image_url: "Image", slug: "Store link", line_order: "Display order", sr_no: "Sr. no.",
  percent: "Discount %", min_quantity: "Minimum quantity", start_date: "Start date", end_date: "End date", status: "Status",
  year: "Year", address: "Address", code: "Code", title: "Title", value: "Value", key: "Setting",
};
// columns that are bookkeeping, not something a person changed
const HIDDEN = new Set(["id", "created_at", "updated_at", "event_id", "created_by", "created_by_name", "updated_by"]);
const MONEY = new Set(["current_rate", "rate", "total", "grand_total"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const label = (k: string) => LABELS[k] ?? k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function show(key: string, v: unknown, names: Record<string, string>): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string" && UUID.test(v)) return names[v] ?? "(unknown)";
  if (MONEY.has(key) && !Number.isNaN(Number(v))) return formatRupees(Number(v));
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function changeLines(changes: Record<string, { old: unknown; new: unknown }>, names: Record<string, string>): string[] {
  return Object.entries(changes)
    .filter(([k]) => !HIDDEN.has(k))
    .map(([k, v]) => `${label(k)}: ${show(k, v.old, names)} → ${show(k, v.new, names)}`);
}

function rowLines(row: Meta, names: Record<string, string>): string[] {
  return Object.entries(row)
    .filter(([k, v]) => !HIDDEN.has(k) && v !== null && v !== "" && k !== "name" && k !== "product_id" && k !== "branch_id")
    .map(([k, v]) => `${label(k)}: ${show(k, v, names)}`);
}

const ENTITY: Record<string, string> = {
  stock: "stock", product: "product", user: "user", event: "event", discount_rule: "discount rule",
  package: "package", package_item: "package item", branch: "branch", setting: "setting",
};

export function describeAudit(action: string, m: Meta): AuditDescription {
  const names = (m._names as Record<string, string> | undefined) ?? {};
  const subject = m._subject as string | undefined;
  const inv = m.invoice_number ? `invoice ${m.invoice_number}` : "an invoice";
  const lines: string[] = [];
  const items = Array.isArray(m.items) ? (m.items as { name: string; qty: number; rate?: string }[]) : [];
  const itemLines = () => items.map((i) => `${i.name} × ${i.qty}${i.rate ? ` @ ${formatRupees(Number(i.rate))}` : ""}`);
  const withCustomer = m.customer ? ` for ${m.customer}` : "";
  const total = m.total !== undefined ? ` (total ${formatRupees(Number(m.total))})` : "";

  switch (action) {
    case "invoice.create": return { title: `Saved a draft of ${inv}${withCustomer}${total}`, lines: itemLines() };
    case "invoice.submit": return { title: `Submitted ${inv}${withCustomer}${total}`, lines: itemLines() };
    case "invoice.revise": {
      if (m.previous_total !== undefined) lines.push(`Total: ${formatRupees(Number(m.previous_total))} → ${formatRupees(Number(m.new_total))}`);
      if (m.reason) lines.push(`Reason: ${m.reason}`);
      return { title: `Changed ${inv}${withCustomer}${m.version ? ` (now version ${m.version})` : ""}`, lines: [...lines, ...itemLines().map((l) => `Now: ${l}`)] };
    }
    case "invoice.cancel": return { title: `Cancelled ${inv}${withCustomer}${total}`, lines: [m.reason ? `Reason: ${m.reason}` : "", ...itemLines().map((l) => `Removed: ${l}`)].filter(Boolean) };
    case "invoice.pdf": return { title: `Generated the PDF of ${inv}${withCustomer}`, lines: [] };
    case "invoice.download": return { title: `Downloaded the PDF of ${inv}`, lines: [] };
    case "stock.transfer":
      return { title: `Moved ${m.quantity} × ${m.product} from ${m.from_branch} to ${m.to_branch}`, lines: m.note ? [`Note: ${m.note}`] : [] };
    case "order.ready": return { title: `Marked online order ${m.order} ready for pick-up (${inv})`, lines: itemLines() };
    case "order.pickup": return { title: `Handed over online order ${m.order} at the counter (${inv})`, lines: itemLines() };
    case "order.paid": return { title: `Online order ${m.order} was paid (${inv})`, lines: m.payment ? [`Razorpay payment: ${m.payment}`] : [] };
    case "auth.login": return { title: "Signed in", lines: [] };
    case "user.password_reset": return { title: `Reset the password of ${subject ?? "a user"}`, lines: [] };
    case "report.export": return { title: "Exported a report", lines: Object.entries(m).filter(([k]) => !k.startsWith("_")).map(([k, v]) => `${label(k)}: ${String(v)}`) };
  }

  const [entity, verb] = action.split(".");
  const what = ENTITY[entity] ?? entity.replace(/_/g, " ");
  const of = subject ? `: ${subject}` : "";
  if (m.new && typeof m.new === "object") {
    return { title: `Added ${what}${of}`, lines: rowLines(m.new as Meta, names) };
  }
  if (m.old && typeof m.old === "object") return { title: `Removed ${what}${of}`, lines: rowLines(m.old as Meta, names) };
  if (m.changes && typeof m.changes === "object") {
    const heading: Record<string, string> = { rate_change: "Changed the rate of", role_change: "Changed the role / branch of", active_change: "Switched on / off" };
    return { title: `${heading[verb] ?? "Changed"} ${what}${of}`, lines: changeLines(m.changes as Record<string, { old: unknown; new: unknown }>, names) };
  }
  // anything else: show whatever was recorded, as plain "label: value" lines
  const rest = Object.entries(m).filter(([k]) => !k.startsWith("_") && !HIDDEN.has(k)).map(([k, v]) => `${label(k)}: ${show(k, v, names)}`);
  return { title: action.replace(/[._]/g, " "), lines: rest };
}
