"use client";

import { useState } from "react";
import { CheckCheck, Pencil, Plus } from "lucide-react";
import { EditDialog, orNull, str, type FieldSpec } from "@/components/admin/edit-dialog";
import { PageHeader } from "@/components/app/page-header";
import { ErrorState, LoadingRows } from "@/components/app/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAsync } from "@/hooks/use-async";
import { formatMoney } from "@/lib/format";
import { ProductStockFlag, useStockAlerts } from "@/components/app/low-stock-alert";
import { api } from "@/lib/services/api";

interface Product { best_seller: boolean; id: string; sku: string; name: string; description: string; hsn_code: string; unit: string; current_rate: string; cgst_rate: string; sgst_rate: string; sr_no: number | null; line_order: number; active: boolean; rate_confirmed: boolean; category: string; image_url: string; online_enabled: boolean; weight_grams?: number; pack_size?: number }

const FIELDS: FieldSpec[] = [
  { key: "name", label: "Particulars (name on the invoice)", wide: true },
  { key: "hsn_code", label: "HSN code", hint: "4 to 8 digits" },
  { key: "unit", label: "Unit" },
  { key: "current_rate", label: "Rate (₹)", type: "number", step: "0.01", hint: "Saving a changed rate marks it as confirmed." },
  { key: "cgst_rate", label: "CGST %", type: "number", step: "0.01" },
  { key: "sgst_rate", label: "SGST %", type: "number", step: "0.01" },
  { key: "line_order", label: "Position in the list", type: "number", step: "1" },
  { key: "sr_no", label: "Sr. number (blank for variant rows)", type: "number", step: "1" },
  { key: "description", label: "Description", type: "textarea" },
  { key: "category", label: "Online store category", hint: "Groups the product in the store, e.g. T-Shirts." },
  { key: "image_url", label: "Photo web address (https://…)", hint: "Shown in the online store. Leave blank for a placeholder.", wide: true },
  { key: "weight_grams", label: "Packed weight of one sold unit (grams)", type: "number", step: "1", hint: "Shown to shoppers and used for the delivery charge. For a product sold in packs, enter the weight of the WHOLE pack (badges: 118 for the 50). Leave 0 if it cannot be delivered." },
  { key: "pack_size", label: "Sold in packs of (units)", type: "number", step: "1", hint: "1 = sold singly. Badges: 50, so 1 selected in the store means 50 units, priced for 50 and taken from stock as 50." },
  { key: "online_enabled", label: "Show in the online store", type: "checkbox" },
  { key: "best_seller", label: "Tag as a best seller in the store", type: "checkbox" },
  { key: "active", label: "Available on new invoices", type: "checkbox" },
  { key: "confirm_rate", label: "I have checked this rate for the current event", type: "checkbox" },
];

export default function ProductsPage() {
  const alerts = useStockAlerts(true, "products");
  const list = useAsync(() => api<Product[]>("/admin/products"), "admin-products");
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [onlyPending, setOnlyPending] = useState(false);
  const [q, setQ] = useState("");
  const isNew = editing === "new";
  const p = editing && editing !== "new" ? editing : null;

  const pending = list.data?.filter((x) => x.active && !x.rate_confirmed).length ?? 0;
  const shown = (list.data ?? []).filter((x) => (!onlyPending || !x.rate_confirmed) && x.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader title="Products and rates" description="The materials that can go on an invoice, with HSN, rate and GST. Existing invoices keep the values they were issued with."
        actions={<><Button variant="outline" disabled={pending === 0} onClick={() => setConfirmAll(true)}><CheckCheck data-icon="inline-start" />Confirm all {pending} pending</Button>
          <Button onClick={() => setEditing("new")}><Plus data-icon="inline-start" />Add product</Button></>} />
      {pending > 0 && (
        <p role="status" className="rounded-lg border border-warning/20 bg-warning/10 p-3 text-sm text-warning">
          {pending} rate(s) are still the <strong>2026 reference values</strong> from the workbook. They are shown to branches as-is until you edit or confirm each one; the event cannot be opened before that.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…" aria-label="Search products" className="max-w-xs" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} />Only unconfirmed rates</label>
      </div>
      {list.error ? <ErrorState message={list.error.message} onRetry={list.reload} /> : !list.data ? <LoadingRows rows={8} /> : (
        <div className="overflow-x-auto rounded-xl glass shadow-card">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left"><tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium"><th>#</th><th>Particulars</th><th>HSN</th><th className="text-right">Rate</th><th className="text-right">CGST+SGST</th><th className="text-right">Weight</th><th>Rate status</th><th /></tr></thead>
            <tbody className="[&>tr]:border-t [&_td]:px-3 [&_td]:py-2">
              {shown.map((x) => (
                <tr key={x.id} data-testid="product-row" className={x.active ? "" : "opacity-60"}>
                  <td className="text-muted-foreground">{x.line_order}</td><td className="font-medium">{x.name.replace(/\s+/g, " ")}{!x.active && <span className="ml-2 text-xs text-muted-foreground">(inactive)</span>}{(x.pack_size ?? 1) > 1 && <span className="ml-2 text-xs text-muted-foreground">(packs of {x.pack_size})</span>}<ProductStockFlag alerts={(alerts.data?.items ?? []).filter((a) => a.product_id === x.id)} /></td>
                  <td className="font-mono">{x.hsn_code}</td><td className="text-right tabular-nums">{formatMoney(Number(x.current_rate))}</td><td className="text-right">{Number(x.cgst_rate)}% + {Number(x.sgst_rate)}%</td>
                  <td className="text-right tabular-nums">{x.weight_grams ? `${x.weight_grams} g` : <span className="text-xs text-warning" title="No weight set: this product cannot be home-delivered">not set</span>}</td>
                  <td>{x.rate_confirmed ? <Badge variant="outline" className="bg-success/10 text-success-fg">Confirmed</Badge> : <Badge variant="outline" className="bg-warning/10 text-warning">2026 reference</Badge>}</td>
                  <td className="text-right"><Button variant="outline" size="icon-sm" aria-label={`Edit ${x.name}`} onClick={() => setEditing(x)}><Pencil /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EditDialog
          key={p?.id ?? "new"}
          title={isNew ? "Add product" : "Edit product"}
          fields={isNew ? FIELDS.filter((f) => f.key !== "confirm_rate") : FIELDS}
          initial={isNew ? { name: "", hsn_code: "", unit: "Nos.", current_rate: "", cgst_rate: "9", sgst_rate: "9", line_order: String((list.data?.length ?? 0) + 1), sr_no: "", description: "", category: "", image_url: "", weight_grams: "0", pack_size: "1", online_enabled: true, best_seller: false, active: true }
            : { name: p!.name, hsn_code: p!.hsn_code, unit: p!.unit, current_rate: p!.current_rate, cgst_rate: p!.cgst_rate, sgst_rate: p!.sgst_rate, line_order: String(p!.line_order), sr_no: p!.sr_no ? String(p!.sr_no) : "", description: p!.description, category: p!.category, image_url: p!.image_url, weight_grams: String(p!.weight_grams ?? 0), pack_size: String(p!.pack_size ?? 1), online_enabled: p!.online_enabled, best_seller: p!.best_seller, active: p!.active, confirm_rate: false }}
          onSave={async (v) => {
            const body = { name: str(v.name), description: str(v.description), hsn_code: str(v.hsn_code), unit: str(v.unit) || "Nos.", current_rate: str(v.current_rate),
              cgst_rate: str(v.cgst_rate), sgst_rate: str(v.sgst_rate), line_order: Number(v.line_order), sr_no: orNull(v.sr_no) ? Number(v.sr_no) : null, active: !!v.active, confirm_rate: !!v.confirm_rate,
              category: str(v.category), image_url: str(v.image_url), weight_grams: Math.max(0, Math.round(Number(v.weight_grams) || 0)), pack_size: Math.max(1, Math.round(Number(v.pack_size) || 1)), online_enabled: !!v.online_enabled, best_seller: !!v.best_seller };
            await api(isNew ? "/admin/products" : `/admin/products/${p!.id}`, { method: isNew ? "POST" : "PUT", body: JSON.stringify(body) });
            list.reload();
          }}
          onClose={() => setEditing(null)}
        />
      )}

      <Dialog open={confirmAll} onOpenChange={setConfirmAll}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm {pending} rates as they are?</DialogTitle>
            <DialogDescription>Only do this after checking the 2027 price list. It marks every pending product as confirmed without changing its numbers.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Not yet</DialogClose>
            <Button onClick={async () => { await api("/admin/products/confirm", { method: "POST", body: "{}" }); setConfirmAll(false); list.reload(); }}>Confirm all</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
