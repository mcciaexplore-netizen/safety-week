"use client";

import { useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ErrorState, LoadingRows } from "@/components/app/states";
import { useAsync } from "@/hooks/use-async";
import { useSession } from "@/hooks/use-session";
import { formatDateTime } from "@/lib/format";
import { describeAudit } from "@/lib/audit-format";
import { API_MODE, services } from "@/lib/services";

const GROUPS = [
  ["", "Everything"],
  ["invoice.", "Invoices"],
  ["edit_request.", "Edit requests"],
  ["auth.", "Sign-ins"],
  ["user.", "Users and roles"],
  ["stock.", "Stock and transfers"],
  ["product.", "Products and prices"],
  ["event.", "Event settings"],
  ["discount_rule.", "Discount rules"],
] as const;

export default function AuditLogPage() {
  const { session } = useSession();
  const [group, setGroup] = useState("");
  const isAdmin = !!session && session.user.role !== "BRANCH_USER";
  const list = useAsync(
    () => (API_MODE && isAdmin ? services.admin.listAudit({ action: group || undefined }) : Promise.resolve(null)),
    `audit:${session?.user.id}:${group}`,
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Audit log"
        description={
          session?.user.role === "SUPER_ADMIN"
            ? "Everything that happened, across all branches. Entries cannot be edited or deleted."
            : `Activity in ${session?.branch.name ?? "your branch"}. Entries cannot be edited or deleted.`
        }
        actions={
          <select
            aria-label="Filter by type"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
          >
            {GROUPS.map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
        }
      />
      {!API_MODE ? (
        <EmptyState title="Available with the live backend" description="The audit log is recorded by the server; demo mode has none." />
      ) : !isAdmin ? (
        <EmptyState title="Admins only" description="Ask a branch admin or the central admin if you need this." />
      ) : list.error ? (
        <ErrorState message={list.error.message} onRetry={list.reload} />
      ) : !list.data ? (
        <LoadingRows rows={8} />
      ) : list.data.length === 0 ? (
        <EmptyState title="Nothing recorded yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl glass shadow-card">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                <th>When</th>
                <th>Who</th>
                <th>Branch</th>
                <th>What happened</th>
              </tr>
            </thead>
            <tbody className="[&>tr]:border-t [&_td]:px-3 [&_td]:py-2">
              {list.data.map((e) => {
                const d = describeAudit(e.action, e.metadata);
                return (
                  <tr key={e.id} data-testid="audit-row" className="align-top">
                    <td className="whitespace-nowrap">{formatDateTime(e.createdAt)}</td>
                    <td>{e.actor || <span className="text-muted-foreground">system / database</span>}</td>
                    <td className="whitespace-nowrap">{e.branchName ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="min-w-[22rem]">
                      <p className="font-medium">{d.title}</p>
                      {d.lines.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-muted-foreground">
                          {d.lines.map((l, i) => <li key={i}>{l}</li>)}
                        </ul>
                      )}
                      <p className="mt-1 font-mono text-[11px] text-muted-foreground/70">{e.action}</p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
