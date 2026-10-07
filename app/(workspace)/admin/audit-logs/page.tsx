"use client";

import { useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ErrorState, LoadingRows } from "@/components/app/states";
import { useAsync } from "@/hooks/use-async";
import { useSession } from "@/hooks/use-session";
import { formatDateTime } from "@/lib/format";
import { API_MODE, services } from "@/lib/services";

const GROUPS = [
  ["", "Everything"],
  ["invoice.", "Invoices"],
  ["auth.", "Sign-ins"],
  ["user.", "Users and roles"],
  ["stock.", "Stock and transfers"],
  ["product.", "Products and prices"],
  ["event.", "Event settings"],
  ["discount_rule.", "Discount rules"],
] as const;

/** One line of plain language for the details column. */
function details(m: Record<string, unknown>): string {
  const parts: string[] = [];
  if (m.invoice_number) parts.push(`${m.invoice_number}${m.version ? ` v${m.version}` : ""}`);
  if (m.reason) parts.push(`reason: ${m.reason}`);
  if (m.previous_total !== undefined) parts.push(`total ${m.previous_total} → ${m.new_total}`);
  if (m.changes && typeof m.changes === "object") {
    for (const [k, v] of Object.entries(m.changes as Record<string, { old: unknown; new: unknown }>))
      parts.push(`${k}: ${JSON.stringify(v.old)} → ${JSON.stringify(v.new)}`);
  }
  if (m.new && typeof m.new === "object") parts.push(String((m.new as Record<string, unknown>).name ?? "created"));
  if (m.from_branch && m.to_branch) parts.push(`${m.quantity} × ${m.product}: ${m.from_branch} → ${m.to_branch}${m.note ? ` (${m.note})` : ""}`);
  if (m.role) parts.push(`role ${m.role}`);
  return parts.join(" · ") || "—";
}

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
                <th>Action</th>
                <th>By</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody className="[&>tr]:border-t [&_td]:px-3 [&_td]:py-2">
              {list.data.map((e) => (
                <tr key={e.id} data-testid="audit-row">
                  <td className="whitespace-nowrap">{formatDateTime(e.createdAt)}</td>
                  <td className="font-mono text-xs">{e.action}</td>
                  <td>{e.actor || <span className="text-muted-foreground">system / database</span>}</td>
                  <td className="max-w-xl truncate" title={details(e.metadata)}>{details(e.metadata)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
