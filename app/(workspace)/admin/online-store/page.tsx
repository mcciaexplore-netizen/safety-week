"use client";

import Link from "next/link";
import { ExternalLink, Globe, Store } from "lucide-react";
import { CountUp } from "@/components/app/count-up";
import { PageHeader } from "@/components/app/page-header";
import { ErrorState, LoadingRows } from "@/components/app/states";
import { useAsync } from "@/hooks/use-async";
import { formatNumber, formatRupeesShort } from "@/lib/format";
import { api } from "@/lib/services/api";

interface Analytics {
  branches: { code: string; name: string; office_invoices: number; office_value: number; online_orders: number; online_value: number }[];
  totals: { online_orders: number; online_value: number; office_invoices: number; office_value: number; online_share: number; online_units: number; office_units: number };
  daily: { day: string; online: boolean; value: number; n: number }[];
  top_online_products: { name: string; units: number; value: number }[];
  order_status: Record<string, number>;
  picked_up_payments: Record<string, number>;
}
const STATUS_LABEL: Record<string, string> = { PLACED: "New", READY: "Ready for pick-up", PICKED_UP: "Collected", CANCELLED: "Cancelled", EXPIRED: "Released" };

export default function OnlineStorePage() {
  const data = useAsync(() => api<Analytics>("/admin/store/analytics"), "online-analytics");
  const a = data.data;
  const days = a ? [...new Set(a.daily.map((d) => d.day))].slice(-14) : [];
  const val = (day: string, online: boolean) => a?.daily.find((d) => d.day === day && d.online === online)?.value ?? 0;
  const max = Math.max(1, ...days.flatMap((d) => [val(d, true), val(d, false)]));
  const storeUrl = typeof window === "undefined" ? "/store" : `${window.location.origin}/store`;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Online store" description="Sales on the public MCCIA Store compared with the five branch offices. Online orders are collected from, and counted in, the branch the customer chose."
        actions={<a href={storeUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-md border bg-white/60 px-4 text-[0.85rem] font-semibold text-muted-foreground hover:border-primary hover:text-primary"><ExternalLink className="size-4" />Open the store</a>} />
      {data.error ? <ErrorState message={data.error.message} onRetry={data.reload} /> : !a ? <LoadingRows rows={6} /> : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Online figures">
            {[
              { label: "Online orders", n: a.totals.online_orders, fmt: formatNumber, icon: Globe },
              { label: "Online sales", n: a.totals.online_value, fmt: formatRupeesShort, icon: Globe },
              { label: "Branch-office sales", n: a.totals.office_value, fmt: formatRupeesShort, icon: Store },
              { label: "Online share of sales", n: a.totals.online_share, fmt: (n: number) => `${n.toFixed(1)}%`, icon: Globe },
            ].map(({ label, n, fmt, icon: Icon }) => (
              <div key={label} className="card-lift glass rounded-xl p-6 text-center shadow-card">
                <span className="icon-tile mx-auto"><Icon className="size-[18px]" /></span>
                <p className="big-number mt-4"><CountUp value={n} format={fmt} /></p>
                <p className="label-xs mt-2">{label}</p>
              </div>
            ))}
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            <div className="glass rounded-xl p-6 shadow-card lg:col-span-2">
              <h2 className="mb-1 text-lg">Online vs branch offices — last 14 days</h2>
              <p className="mb-4 flex gap-4 text-xs text-muted-foreground"><span className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-sm bg-success" />Online</span><span className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-sm bg-primary" />Branch offices</span></p>
              {days.length === 0 ? <p className="text-sm text-muted-foreground">No sales yet.</p> : (
                <div className="flex h-48 items-end gap-2">
                  {days.map((d) => (
                    <div key={d} className="flex h-full flex-1 flex-col justify-end gap-1" title={`${d}: online ${formatRupeesShort(val(d, true))}, offices ${formatRupeesShort(val(d, false))}`}>
                      <div className="flex flex-1 items-end justify-center gap-0.5">
                        <div className="w-1/2 rounded-t bg-primary" style={{ height: `${Math.max(2, (val(d, false) / max) * 100)}%` }} />
                        <div className="w-1/2 rounded-t bg-success" style={{ height: `${Math.max(2, (val(d, true) / max) * 100)}%` }} />
                      </div>
                      <span className="text-center text-[0.6rem] text-muted-foreground">{d.slice(5)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="glass rounded-xl p-6 shadow-card">
              <h2 className="mb-4 text-lg">Orders by status</h2>
              <ul className="space-y-2 text-sm">
                {Object.entries(a.order_status).length === 0 ? <li className="text-muted-foreground">No online orders yet.</li> : Object.entries(a.order_status).map(([k, n]) => (
                  <li key={k} className="flex justify-between"><span>{STATUS_LABEL[k] ?? k}</span><span className="font-semibold tabular-nums">{n}</span></li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-muted-foreground">Open the <Link className="font-semibold text-primary" href="/online-orders">Online orders</Link> screen to prepare and hand over orders.</p>
            </div>
          </section>

          <section className="glass overflow-x-auto rounded-xl shadow-card">
            <table className="w-full text-sm">
              <thead className="text-left"><tr className="[&>th]:px-4 [&>th]:py-3"><th>Branch</th><th className="text-right">Office invoices</th><th className="text-right">Office sales</th><th className="text-right">Online orders</th><th className="text-right">Online sales</th></tr></thead>
              <tbody className="[&>tr]:border-t [&_td]:px-4 [&_td]:py-3">
                {a.branches.map((b) => (
                  <tr key={b.code}><td className="font-medium">{b.name}</td><td className="text-right tabular-nums">{b.office_invoices}</td><td className="text-right tabular-nums">{formatRupeesShort(b.office_value)}</td><td className="text-right tabular-nums">{b.online_orders}</td><td className="text-right font-semibold tabular-nums text-success-fg">{formatRupeesShort(b.online_value)}</td></tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="glass rounded-xl p-6 shadow-card">
            <h2 className="mb-4 text-lg">Top online products</h2>
            {a.top_online_products.length === 0 ? <p className="text-sm text-muted-foreground">No online sales yet.</p> : (
              <ul className="space-y-3">
                {a.top_online_products.map((p) => (
                  <li key={p.name}><div className="flex justify-between text-sm"><span>{p.name.replace(/\s+/g, " ")}</span><span className="tabular-nums">{formatRupeesShort(p.value)} · {formatNumber(p.units)} units</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-success" style={{ width: `${(p.value / a.top_online_products[0].value) * 100}%` }} /></div></li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
