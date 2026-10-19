"use client";

import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ErrorState, LoadingRows } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAsync } from "@/hooks/use-async";
import { api } from "@/lib/services/api";

interface Config {
  enabled: boolean; courier: string; packing_grams: number; slabs: { up_to_grams: number; charge: string | number }[];
  extra_per_kg: string | number; gst_percent: string | number; sac_code: string; delivery_days: string; max_weight_grams: number; tracking_url_template: string;
}

// Starting values for a typical India-wide courier rate card. They are estimates, not DTDC's own prices: check them against your rate card.
const SUGGESTED = {
  packing_grams: 200, max_weight_grams: 20000, extra_per_kg: "50", gst_percent: "18", sac_code: "996812", delivery_days: "3-5 working days",
  slabs: [{ up_to_grams: 500, charge: "70" }, { up_to_grams: 1000, charge: "110" }, { up_to_grams: 2000, charge: "170" }, { up_to_grams: 5000, charge: "300" }],
};

function priceFor(c: Config, grams: number) {
  const slabs = c.slabs.map((s) => ({ g: Number(s.up_to_grams), c: Number(s.charge) })).filter((s) => s.g > 0 && Number.isFinite(s.c)).sort((a, b) => a.g - b.g);
  if (!slabs.length) return null;
  const hit = slabs.find((s) => grams <= s.g);
  const last = slabs[slabs.length - 1];
  return hit ? hit.c : last.c + Number(c.extra_per_kg || 0) * Math.ceil((grams - last.g) / 1000);
}

export default function DeliverySettingsPage() {
  const cfg = useAsync(() => api<Config>("/admin/delivery-settings"), "admin-delivery");
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Delivery" description="Home delivery by courier (DTDC). Set each product's weight on the Products page, then the price list here. Customers can choose delivery only when it is switched on and every item in their cart has a weight." />
      {cfg.error ? <ErrorState message={cfg.error.message} onRetry={cfg.reload} /> : !cfg.data ? <LoadingRows rows={6} /> : <Form initial={cfg.data} onSaved={cfg.reload} />}
    </div>
  );
}

function Form({ initial, onSaved }: { initial: Config; onSaved: () => void }) {
  const fresh = initial.slabs.length === 0;  // nothing saved yet: start from the suggested values (shown, not saved until "Save")
  const [c, setC] = useState<Config>(fresh ? { ...initial, ...SUGGESTED, enabled: true, slabs: SUGGESTED.slabs.map((x) => ({ ...x })) } : { ...initial, slabs: initial.slabs.map((x) => ({ ...x })) });
  const [testKg, setTestKg] = useState("0.75");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof Config>(k: K, v: Config[K]) => setC((p) => ({ ...p, [k]: v }));
  const setSlab = (i: number, k: "up_to_grams" | "charge", v: string) => setC((p) => ({ ...p, slabs: p.slabs.map((s, j) => (j === i ? { ...s, [k]: v } : s)) }));

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const body = {
        enabled: c.enabled, courier: String(c.courier).trim() || "DTDC", packing_grams: Math.max(0, Math.round(Number(c.packing_grams) || 0)),
        slabs: c.slabs.map((s) => ({ up_to_grams: Math.round(Number(s.up_to_grams)), charge: Number(s.charge).toFixed(2) })),
        extra_per_kg: Number(c.extra_per_kg || 0).toFixed(2), gst_percent: String(c.gst_percent || 0), sac_code: String(c.sac_code).trim() || "996812",
        delivery_days: String(c.delivery_days).trim() || "2-3 working days", max_weight_grams: Math.max(0, Math.round(Number(c.max_weight_grams) || 0)),
        tracking_url_template: String(c.tracking_url_template).trim(),
      };
      await api("/admin/delivery-settings", { method: "PUT", body: JSON.stringify(body) });
      setMsg({ ok: true, text: "Saved." });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not save." });
    } finally { setBusy(false); }
  }

  const field = (id: string, label: string, el: React.ReactNode, hint?: string) => (
    <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label>{el}{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>
  );

  const testGrams = Math.round((Number(testKg) || 0) * 1000);
  const testBase = priceFor(c, 1);

  return (
    <div className="space-y-6">
      {fresh && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm" role="status">
          <p className="font-semibold">We have filled in typical starting values for you.</p>
          <p className="mt-1 text-muted-foreground">These are estimates, not DTDC&apos;s own prices. Change the rupee amounts if your DTDC rate card is different, then press <b>Save</b>. Nothing is live until you save.</p>
        </div>
      )}
      <section className="glass space-y-4 rounded-xl p-6 shadow-card">
        <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" className="size-4" checked={c.enabled} onChange={(e) => set("enabled", e.target.checked)} data-testid="delivery-enabled" />Offer home delivery in the online store</label>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("courier", "Courier", <Input id="courier" value={c.courier} onChange={(e) => set("courier", e.target.value)} />)}
          {field("days", "Delivery time shown to customers", <Input id="days" value={c.delivery_days} onChange={(e) => set("delivery_days", e.target.value)} />, "e.g. 2-3 working days")}
          {field("packing", "Packing weight added to every parcel (grams)", <Input id="packing" type="number" min={0} value={c.packing_grams} onChange={(e) => set("packing_grams", Number(e.target.value))} />, "The weight of the box, tape and bubble wrap. We add it to the products' weight. 200 is a good guess.")}
          {field("max", "Heaviest parcel allowed (grams, 0 = no limit)", <Input id="max" type="number" min={0} value={c.max_weight_grams} onChange={(e) => set("max_weight_grams", Number(e.target.value))} />, "Orders heavier than this cannot use home delivery. 20000 = 20 kg.")}
        </div>
      </section>

      <section className="glass space-y-4 rounded-xl p-6 shadow-card">
        <div>
          <h2 className="text-lg">Delivery charge by weight</h2>
          <p className="text-sm text-muted-foreground">The charge is the first row whose weight limit covers the parcel (before GST). Above the last row: the last charge plus the extra amount for every started kg.</p>
        </div>
        <div className="space-y-2">
          {c.slabs.map((s, i) => (
            <div key={i} className="flex flex-wrap items-end gap-3" data-testid="slab-row">
              {field(`g${i}`, "Up to (grams)", <Input id={`g${i}`} type="number" min={1} className="w-36" value={s.up_to_grams} onChange={(e) => setSlab(i, "up_to_grams", e.target.value)} />)}
              {field(`c${i}`, "Charge (₹, before GST)", <Input id={`c${i}`} type="number" min={0} step="0.01" className="w-40" value={s.charge} onChange={(e) => setSlab(i, "charge", e.target.value)} />)}
              <Button type="button" variant="outline" size="sm" aria-label="Remove this row" onClick={() => setC((p) => ({ ...p, slabs: p.slabs.filter((_, j) => j !== i) }))}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setC((p) => ({ ...p, slabs: [...p.slabs, { up_to_grams: "" as unknown as number, charge: "" }] }))}><Plus data-icon="inline-start" />Add a row</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setC((p) => ({ ...p, ...SUGGESTED, slabs: SUGGESTED.slabs.map((x) => ({ ...x })) }))}>Fill in typical rates</Button>
          </div>
        </div>
        <div className="rounded-lg bg-muted/50 p-4 text-sm" data-testid="price-check">
          <p className="font-semibold">Check a price</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span>A parcel of</span>
            <Input aria-label="Parcel weight in kg" type="number" min={0} step="0.1" className="w-24" value={testKg} onChange={(e) => setTestKg(e.target.value)} />
            <span>kg (plus {c.packing_grams || 0} g packing) costs the customer:</span>
          </div>
          <p className="mt-2">{testBase === null ? "Add at least one row above to see a price." : testGrams <= 0 ? "Type a weight above." : (() => {
            const b = priceFor(c, testGrams + Number(c.packing_grams || 0)) ?? 0; const g = b * Number(c.gst_percent || 0) / 100;
            return <>₹{b.toFixed(2)} + ₹{g.toFixed(2)} GST = <b>₹{(b + g).toFixed(2)}</b></>;
          })()}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {field("extra", "Extra for each kg above the last row (₹)", <Input id="extra" type="number" min={0} step="0.01" value={c.extra_per_kg} onChange={(e) => set("extra_per_kg", e.target.value)} />, "Only used for parcels heavier than your last row. Every started kg counts.")}
          {field("gst", "GST on delivery (%)", <Input id="gst" type="number" min={0} max={28} step="0.01" value={c.gst_percent} onChange={(e) => set("gst_percent", e.target.value)} />, "Added on top of the charge. 18 is the normal rate for courier services.")}
          {field("sac", "SAC code on the invoice", <Input id="sac" value={c.sac_code} onChange={(e) => set("sac_code", e.target.value)} />, "Tax code for courier services. Leave it as it is.")}
        </div>
      </section>

      <section className="glass space-y-4 rounded-xl p-6 shadow-card">
        <h2 className="text-lg">Tracking link</h2>
        {field("track", "Courier tracking link pattern (optional)", <Input id="track" placeholder="https://…{awb}…" value={c.tracking_url_template} onChange={(e) => set("tracking_url_template", e.target.value)} />,
          "{awb} is replaced by the consignment number you enter when you ship an order. Leave empty to e-mail only the number, or paste a link for each order instead.")}
      </section>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={busy} data-testid="save-delivery">{busy && <Loader2 className="animate-spin" data-icon="inline-start" />}Save</Button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success-fg" : "text-sm text-danger"}>{msg.text}</p>}
      </div>
    </div>
  );
}
