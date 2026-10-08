"use client";

import Link from "next/link";
import { AlertTriangle, CalendarClock, FileText, IndianRupee, Users } from "lucide-react";
import { LowStockBanner } from "@/components/app/low-stock-alert";
import { PageHeader } from "@/components/app/page-header";
import { ErrorState, LoadingRows } from "@/components/app/states";
import { useAsync } from "@/hooks/use-async";
import { formatRupeesShort } from "@/lib/format";
import { api } from "@/lib/services/api";

interface Event { id: string; name: string; year: number; status: string; start_date: string | null; end_date: string | null; unconfirmed_products: number }
interface Report { totals: { invoices: number; value: string | number }; by_branch: { code: string; name: string; invoices: number; value: string | number }[] }
interface User { active: boolean }

export default function AdminOverview() {
  const data = useAsync(async () => {
    const [events, report, users] = await Promise.all([
      api<Event[]>("/admin/events"), api<Report>("/admin/reports"), api<User[]>("/admin/users"),
    ]);
    return { event: events[0], report, users };
  }, "admin-overview");

  if (data.error) return <ErrorState message={data.error.message} onRetry={data.reload} />;
  if (!data.data) return <LoadingRows rows={6} />;
  const { event, report, users } = data.data;
  const warnings = [
    event.unconfirmed_products > 0 && { text: `${event.unconfirmed_products} product rate(s) are still the 2026 reference values and have not been confirmed for ${event.year}.`, href: "/admin/products", cta: "Review rates" },
    !(event.start_date && event.end_date) && { text: `The ${event.year} event dates have not been set.`, href: "/admin/event", cta: "Set dates" },
    event.status === "PLANNING" && { text: `The ${event.year} event is still in PLANNING (it cannot be opened until dates are set and every rate is confirmed).`, href: "/admin/event", cta: "Event configuration" },
  ].filter(Boolean) as { text: string; href: string; cta: string }[];

  const cards = [
    { label: "Invoices (sales)", value: String(report.totals.invoices), icon: FileText, sub: "submitted, PDF-generated or edited" },
    { label: "Invoice value", value: formatRupeesShort(Number(report.totals.value)), icon: IndianRupee, sub: "all branches" },
    { label: `Event ${event.year}`, value: event.status, icon: CalendarClock, sub: event.start_date ? `${event.start_date} to ${event.end_date}` : "dates not set" },
    { label: "Active users", value: String(users.filter((u) => u.active).length), icon: Users, sub: `${users.length} accounts` },
  ];

  return (
    <>
      <PageHeader title="Admin overview" description={`${event.name} ${event.year} across all five branches.`} />
      <LowStockBanner />
      {warnings.length > 0 && (
        <div className="space-y-2" role="region" aria-label="Needs attention">
          {warnings.map((w) => (
            <div key={w.text} className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/20 bg-warning/10 p-3 text-sm text-warning">
              <AlertTriangle className="size-4 shrink-0" />
              <span className="flex-1">{w.text}</span>
              <Link href={w.href} className="font-medium underline">{w.cta}</Link>
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, icon: Icon, sub }) => (
          <div key={label} className="rounded-xl glass shadow-card p-5">
            <div className="flex items-center justify-between text-sm text-muted-foreground">{label}<Icon className="size-4" /></div>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
            <p className="text-xs text-muted-foreground">{sub}</p>
          </div>
        ))}
      </div>
      <div className="rounded-xl glass shadow-card">
        <h2 className="border-b px-5 py-3 font-medium">By branch</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground"><tr className="[&>th]:px-5 [&>th]:py-2 [&>th]:font-medium"><th>Branch</th><th className="text-right">Invoices</th><th className="text-right">Value</th></tr></thead>
          <tbody className="[&>tr]:border-t [&_td]:px-5 [&_td]:py-2">
            {report.by_branch.map((b) => (
              <tr key={b.code}><td>{b.name} <span className="font-mono text-xs text-muted-foreground">{b.code}</span></td><td className="text-right tabular-nums">{b.invoices}</td><td className="text-right tabular-nums">{formatRupeesShort(Number(b.value))}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
