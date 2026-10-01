"use client";

import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAsync } from "@/hooks/use-async";
import { api } from "@/lib/services/api";

interface Product { id: string; name: string; active: boolean }
interface Pkg { id: string; name: string; description: string; fixed_price: string | null; active: boolean; items: { product_id: string; quantity: number }[] }
const SEL = "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm";

/** Package / bundle editor: a name, an optional fixed price, and a list of (product, quantity) rows. */
export function PackageDialog({ pkg, onSaved, onClose }: { pkg: Pkg | null; onSaved: () => void; onClose: () => void }) {
  const products = useAsync(() => api<Product[]>("/admin/products"), "pkg-products");
  const [name, setName] = useState(pkg?.name ?? "");
  const [description, setDescription] = useState(pkg?.description ?? "");
  const [price, setPrice] = useState(pkg?.fixed_price ? String(Number(pkg.fixed_price)) : "");
  const [active, setActive] = useState(pkg?.active ?? true);
  const [rows, setRows] = useState<{ product_id: string; quantity: string }[]>(
    pkg?.items.map((i) => ({ product_id: i.product_id, quantity: String(i.quantity) })) ?? [{ product_id: "", quantity: "1" }],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { name: name.trim(), description: description.trim(), fixed_price: price.trim() || null, active,
        items: rows.filter((r) => r.product_id).map((r) => ({ product_id: r.product_id, quantity: Number(r.quantity) })) };
      await api(pkg ? `/admin/packages/${pkg.id}` : "/admin/packages", { method: pkg ? "PUT" : "POST", body: JSON.stringify(body) });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <form onSubmit={save} className="space-y-4">
          <DialogHeader><DialogTitle>{pkg ? "Edit package" : "Add package"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="pk-name">Package name</Label><Input id="pk-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="pk-price">Package price (₹, optional)</Label><Input id="pk-price" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="pk-desc">Description</Label><Input id="pk-desc" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          </div>
          <div className="space-y-2">
            <Label>Contents</Label>
            {rows.map((r, i) => (
              <div key={i} className="flex gap-2">
                <select aria-label={`Product ${i + 1}`} className={SEL} value={r.product_id} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, product_id: e.target.value } : x)))}>
                  <option value="">Choose product…</option>
                  {products.data?.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name.replace(/\s+/g, " ")}</option>)}
                </select>
                <Input aria-label={`Quantity ${i + 1}`} className="w-24" type="number" min={1} value={r.quantity} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove row ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 /></Button>
              </div>
            ))}
            <Button type="button" variant="outline" onClick={() => setRows([...rows, { product_id: "", quantity: "1" }])}><Plus data-icon="inline-start" />Add product</Button>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Package is active</label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={busy} />}>Cancel</DialogClose>
            <Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" data-icon="inline-start" />}Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
