"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { EditDialog, orNull, str, type FieldSpec } from "@/components/admin/edit-dialog";
import { PackageDialog } from "@/components/admin/package-dialog";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ErrorState, LoadingRows } from "@/components/app/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAsync } from "@/hooks/use-async";
import { formatMoney } from "@/lib/format";
import { api } from "@/lib/services/api";

interface Rule { id: string; name: string; threshold: string | null; percentage: string | null; fixed_amount: string | null; valid_from: string | null; valid_until: string | null; active: boolean }
export interface Pkg { id: string; name: string; description: string; fixed_price: string | null; active: boolean; items: { product_id: string; quantity: number; product_name: string }[] }

const RULE_FIELDS: FieldSpec[] = [
  { key: "name", label: "Rule name", wide: true },
  { key: "kind", label: "Discount type", type: "select", options: [["percentage", "Percentage off the rate"], ["fixed_amount", "Fixed amount"]] },
  { key: "value", label: "Value (% or ₹)", type: "number", step: "0.01" },
  { key: "threshold", label: "Applies from order value (₹)", type: "number", step: "0.01", hint: "Leave empty for no minimum." },
  { key: "valid_from", label: "Valid from", type: "date" },
  { key: "valid_until", label: "Valid until", type: "date" },
  { key: "active", label: "Rule is active", type: "checkbox" },
];

export default function DiscountsPage() {
  const rules = useAsync(() => api<Rule[]>("/admin/discount-rules"), "admin-rules");
  const pkgs = useAsync(() => api<Pkg[]>("/admin/packages"), "admin-pkgs");
  const [rule, setRule] = useState<Rule | "new" | null>(null);
  const [pkg, setPkg] = useState<Pkg | "new" | null>(null);
  const r = rule && rule !== "new" ? rule : null;

  const remove = async (path: string, done: () => void, what: string) => {
    if (window.confirm(`Delete ${what}? This cannot be undone.`)) { await api(path, { method: "DELETE" }); done(); }
  };

  return (
    <>
      <PageHeader title="Discounts and packages" description="Discount rules and bundle definitions for the current event." />
      <p className="rounded-lg border bg-secondary/50 p-3 text-sm">
        These are <strong>definitions</strong> kept per event. Invoices do not apply them automatically yet — the invoice form still uses the manual “Discount on rate (%)” field.
      </p>

      <section className="space-y-3" aria-label="Discount rules">
        <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Discount rules</h2><Button onClick={() => setRule("new")}><Plus data-icon="inline-start" />Add rule</Button></div>
        {rules.error ? <ErrorState message={rules.error.message} onRetry={rules.reload} /> : !rules.data ? <LoadingRows rows={2} /> : rules.data.length === 0 ? <EmptyState title="No discount rules yet" /> : (
          <div className="overflow-x-auto rounded-lg border bg-card"><table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left"><tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium"><th>Name</th><th>Discount</th><th>From order value</th><th>Valid</th><th>Status</th><th /></tr></thead>
            <tbody className="[&>tr]:border-t [&_td]:px-3 [&_td]:py-2">
              {rules.data.map((x) => (
                <tr key={x.id} data-testid="rule-row"><td className="font-medium">{x.name}</td>
                  <td>{x.percentage ? `${Number(x.percentage)}%` : `₹${formatMoney(Number(x.fixed_amount))}`}</td><td>{x.threshold ? `₹${formatMoney(Number(x.threshold))}` : "—"}</td>
                  <td>{x.valid_from ?? "…"} to {x.valid_until ?? "…"}</td><td>{x.active ? <Badge variant="outline">Active</Badge> : <Badge variant="outline" className="bg-slate-100">Off</Badge>}</td>
                  <td><div className="flex justify-end gap-1.5"><Button variant="outline" size="icon-sm" aria-label={`Edit ${x.name}`} onClick={() => setRule(x)}><Pencil /></Button>
                    <Button variant="outline" size="icon-sm" aria-label={`Delete ${x.name}`} onClick={() => remove(`/admin/discount-rules/${x.id}`, rules.reload, `the rule “${x.name}”`)}><Trash2 /></Button></div></td></tr>
              ))}
            </tbody></table></div>
        )}
      </section>

      <section className="space-y-3" aria-label="Packages">
        <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Packages and bundles</h2><Button onClick={() => setPkg("new")}><Plus data-icon="inline-start" />Add package</Button></div>
        {pkgs.error ? <ErrorState message={pkgs.error.message} onRetry={pkgs.reload} /> : !pkgs.data ? <LoadingRows rows={2} /> : pkgs.data.length === 0 ? <EmptyState title="No packages yet" /> : (
          <div className="grid gap-3 md:grid-cols-2">
            {pkgs.data.map((x) => (
              <div key={x.id} data-testid="package-card" className="space-y-2 rounded-lg border bg-card p-4">
                <div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{x.name} {!x.active && <span className="text-xs font-normal text-muted-foreground">(off)</span>}</p>
                  <p className="text-sm text-muted-foreground">{x.description}</p></div>
                  <div className="flex gap-1.5"><Button variant="outline" size="icon-sm" aria-label={`Edit ${x.name}`} onClick={() => setPkg(x)}><Pencil /></Button>
                    <Button variant="outline" size="icon-sm" aria-label={`Delete ${x.name}`} onClick={() => remove(`/admin/packages/${x.id}`, pkgs.reload, `the package “${x.name}”`)}><Trash2 /></Button></div></div>
                <ul className="text-sm">{x.items.map((i) => <li key={i.product_id}>{i.quantity} × {i.product_name.replace(/\s+/g, " ")}</li>)}</ul>
                <p className="text-sm font-medium">{x.fixed_price ? `Package price ₹${formatMoney(Number(x.fixed_price))}` : "Priced at the normal rates"}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {rule && (
        <EditDialog key={r?.id ?? "new"} title={r ? "Edit discount rule" : "Add discount rule"} fields={RULE_FIELDS}
          initial={r ? { name: r.name, kind: r.percentage ? "percentage" : "fixed_amount", value: String(Number(r.percentage ?? r.fixed_amount)), threshold: r.threshold ? String(Number(r.threshold)) : "", valid_from: r.valid_from ?? "", valid_until: r.valid_until ?? "", active: r.active }
            : { name: "", kind: "percentage", value: "", threshold: "", valid_from: "", valid_until: "", active: true }}
          onSave={async (v) => {
            const body = { name: str(v.name), threshold: orNull(v.threshold), percentage: v.kind === "percentage" ? str(v.value) : null, fixed_amount: v.kind === "fixed_amount" ? str(v.value) : null, valid_from: orNull(v.valid_from), valid_until: orNull(v.valid_until), active: !!v.active };
            await api(r ? `/admin/discount-rules/${r.id}` : "/admin/discount-rules", { method: r ? "PUT" : "POST", body: JSON.stringify(body) });
            rules.reload();
          }}
          onClose={() => setRule(null)} />
      )}
      {pkg && <PackageDialog key={pkg === "new" ? "new" : pkg.id} pkg={pkg === "new" ? null : pkg} onSaved={pkgs.reload} onClose={() => setPkg(null)} />}
    </>
  );
}
