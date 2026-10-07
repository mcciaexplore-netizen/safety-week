"use client";

import Link from "next/link";
import { FilePlus2, FileText, IndianRupee, Package, PencilLine } from "lucide-react";
import { CountUp } from "@/components/app/count-up";
import { GridBackdrop } from "@/components/app/grid-backdrop";
import { LowStockCard } from "@/components/app/low-stock-card";
import { PageHeader } from "@/components/app/page-header";
import { ErrorState, LoadingRows } from "@/components/app/states";
import { STATUS_LABEL } from "@/components/app/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAsync } from "@/hooks/use-async";
import { useSession } from "@/hooks/use-session";
import { formatNumber, formatRupeesShort } from "@/lib/format";
import { services } from "@/lib/services";

export default function DashboardPage() {
  const { session } = useSession();
  const summary = useAsync(() => services.dashboard.getSummary(), `dash:${session?.branch.id}`);
  const s = summary.data;

  const kpis = s
    ? [
        { label: "Invoices (active)", n: s.invoiceCount, fmt: formatNumber, sub: `${s.submittedCount} submitted`, icon: FileText },
        { label: "Invoice value", n: s.totalValue, fmt: formatRupeesShort, sub: `Avg ${formatRupeesShort(s.averageValue)} per invoice`, icon: IndianRupee },
        { label: "Drafts pending", n: s.draftCount, fmt: formatNumber, sub: "Finish and submit", icon: PencilLine },
        { label: "Units ordered", n: s.unitsSold, fmt: formatNumber, sub: "Across all materials", icon: Package },
      ]
    : [];
  const maxMonthly = Math.max(1, ...(s?.monthly.map((m) => m.value) ?? [1]));
  const maxProduct = Math.max(1, ...(s?.topProducts.map((p) => p.value) ?? [1]));
  const totalStatus = Math.max(1, s?.statusBreakdown.reduce((a, b) => a + b.count, 0) ?? 1);

  return (
    <div className="reveal mx-auto max-w-6xl space-y-6">
      <div className="relative py-4">
        <GridBackdrop />
      <PageHeader
        eyebrow={session ? `${session.branch.name} branch` : undefined}
        title="Dashboard"
        description={session ? `Welcome back, ${session.user.name}. Here is how ${session.branch.name} is doing.` : undefined}
        actions={
          <>
            <Link href="/invoices" className={buttonVariants({ variant: "outline" })}>
              View all invoices
            </Link>
            <Link href="/invoices/new" className={buttonVariants()}>
              <FilePlus2 data-icon="inline-start" />
              New Proforma
            </Link>
          </>
        }
      />
      </div>

      {summary.error && (
        <ErrorState
          title="Could not load dashboard"
          message={summary.error.message}
          onRetry={summary.reload}
        />
      )}

      <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {!s && !summary.error
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)
          : kpis.map(({ label, n, fmt, sub, icon: Icon }) => (
              <div key={label} className="card-lift rounded-xl glass shadow-card p-6 text-center">
                <span className="icon-tile mx-auto">
                  <Icon className="size-[18px]" />
                </span>
                <p className="big-number mt-4">
                  <CountUp value={n} format={fmt} />
                </p>
                <p className="label-xs mt-2">{label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
              </div>
            ))}
      </section>

      {s && (
        <>
          <section className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl glass shadow-card p-5 lg:col-span-2">
              <h2 className="mb-4 font-medium">Invoice value by month</h2>
              {s.monthly.length === 0 ? (
                <p className="text-sm text-muted-foreground">No invoices yet.</p>
              ) : (
                <div className="flex h-48 items-stretch gap-4">
                  {s.monthly.map((m) => (
                    <div key={m.label} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                      <span className="text-xs font-medium">{formatRupeesShort(m.value)}</span>
                      <div
                        className="w-full max-w-20 rounded-t bg-brand-gradient"
                        style={{ height: `${Math.max(4, (m.value / maxMonthly) * 70)}%` }}
                        role="img"
                        aria-label={`${m.label}: ${formatRupeesShort(m.value)}`}
                      />
                      <span className="text-xs text-muted-foreground">{m.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-xl glass shadow-card p-5">
              <h2 className="mb-4 font-medium">Status breakdown</h2>
              <ul className="space-y-3">
                {s.statusBreakdown.map((b) => (
                  <li key={b.status} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span>{STATUS_LABEL(b.status)}</span>
                      <span className="font-medium">{b.count}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${(b.count / totalStatus) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl glass shadow-card p-5">
              <h2 className="mb-4 font-medium">Top materials (basic value)</h2>
              {s.topProducts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No items ordered yet.</p>
              ) : (
                <ul className="space-y-3">
                  {s.topProducts.map((p) => (
                    <li key={p.name} className="space-y-1">
                      <div className="flex justify-between gap-2 text-sm">
                        <span className="truncate">{p.name}</span>
                        <span className="shrink-0 font-medium">{formatRupeesShort(p.value)}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full bg-brand-accent"
                          style={{ width: `${(p.value / maxProduct) * 100}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <LowStockCard />
          </section>
        </>
      )}
      {!s && !summary.error && <LoadingRows rows={4} />}
    </div>
  );
}
