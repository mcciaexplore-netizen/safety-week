"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { ErrorState, LoadingRows } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { useAsync } from "@/hooks/use-async";
import { api } from "@/lib/services/api";

interface Modes { pay_at_branch: boolean; online_pickup: boolean; delivery: boolean; delivery_ready: boolean; online_ready: boolean }

const OPTIONS: { key: "pay_at_branch" | "online_pickup" | "delivery"; title: string; help: string }[] = [
  { key: "pay_at_branch", title: "Pay at the branch and pick up", help: "The customer reserves online and pays at the counter when collecting." },
  { key: "online_pickup", title: "Pay online and pick up", help: "Paid through Razorpay first; the customer then collects from the branch." },
  { key: "delivery", title: "Pay online and get it delivered", help: "Paid through Razorpay first; sent by courier with a weight-based delivery charge." },
];

/** The central admin switches each way of ordering on or off. A switched-off option disappears from checkout and is refused by the server. */
export function CheckoutModes() {
  const state = useAsync(() => api<Modes>("/admin/checkout-modes"), "checkout-modes");
  if (state.error) return <ErrorState message={state.error.message} onRetry={state.reload} />;
  if (!state.data) return <LoadingRows rows={3} />;
  return <Form key={JSON.stringify(state.data)} initial={state.data} onSaved={state.reload} />;
}

function Form({ initial, onSaved }: { initial: Modes; onSaved: () => void }) {
  const [v, setV] = useState({ pay_at_branch: initial.pay_at_branch, online_pickup: initial.online_pickup, delivery: initial.delivery });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = v.pay_at_branch !== initial.pay_at_branch || v.online_pickup !== initial.online_pickup || v.delivery !== initial.delivery;

  async function save() {
    setBusy(true); setMsg(null);
    try {
      await api("/admin/checkout-modes", { method: "PUT", body: JSON.stringify(v) });
      setMsg({ ok: true, text: "Saved. The store checkout has been updated." });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not save." });
    } finally { setBusy(false); }
  }

  return (
    <section className="glass space-y-4 rounded-xl p-6 shadow-card" data-testid="checkout-modes">
      <div>
        <h2 className="text-lg">Ways to order</h2>
        <p className="text-sm text-muted-foreground">Switch each option on or off whenever you need to. Customers only see the options that are on.</p>
      </div>
      <div className="space-y-3">
        {OPTIONS.map(({ key, title, help }) => (
          <label key={key} className="flex cursor-pointer items-start gap-3 rounded-lg border bg-white/60 p-3">
            <input type="checkbox" className="mt-1 size-4" checked={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.checked })} data-testid={`mode-${key}`} />
            <span className="text-sm">
              <span className="block font-semibold">{title}</span>
              <span className="block text-xs text-muted-foreground">{help}</span>
              {key !== "pay_at_branch" && !initial.online_ready && <span className="block text-xs text-warning">Razorpay is not set up on this server, so this cannot be offered yet.</span>}
              {key === "delivery" && !initial.delivery_ready && <span className="block text-xs text-warning">Set the delivery price list first on the <Link href="/admin/delivery" className="underline">Delivery page</Link>.</span>}
            </span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={busy || !dirty} data-testid="save-modes">{busy && <Loader2 className="animate-spin" data-icon="inline-start" />}Save</Button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success-fg" : "text-sm text-danger"}>{msg.text}</p>}
      </div>
    </section>
  );
}
