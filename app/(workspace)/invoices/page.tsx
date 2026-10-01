"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, FilePlus2, Pencil, Search } from "lucide-react";
import { DownloadButton } from "@/components/app/download-button";
import { DailyExcel } from "@/components/app/daily-excel";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ErrorState, LoadingRows } from "@/components/app/states";
import { PaymentBadge, StatusBadge, STATUS_LABEL } from "@/components/app/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAsync } from "@/hooks/use-async";
import { useSession } from "@/hooks/use-session";
import { formatDateTime, formatInvoiceDate, formatRupees } from "@/lib/format";
import { API_MODE, services } from "@/lib/services";
import type { InvoiceStatus } from "@/lib/types";

const STATUSES: (InvoiceStatus | "ALL")[] = ["ALL", "DRAFT", "SUBMITTED", "GENERATED", "EDITED", "CANCELLED"];

const DATE_CLS =
  "h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export default function InvoicesPage() {
  const { session } = useSession();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<InvoiceStatus | "ALL">("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const list = useAsync(
    () => services.invoices.list({ query, status, from, to }),
    `inv:${session?.branch.id}:${query}:${status}:${from}:${to}`,
  );
  const filtered = query !== "" || status !== "ALL" || from !== "" || to !== "";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        eyebrow={session ? `${session.branch.name} branch` : undefined}
        title="Invoice history"
        description="Search by invoice ID or customer. Open, revise or download any invoice."
        actions={
          <Link href="/invoices/new" className={buttonVariants()}>
            <FilePlus2 data-icon="inline-start" />
            New Pro Forma
          </Link>
        }
      />

      {API_MODE && session && session.user.role !== "BRANCH_USER" && <DailyExcel central={false} />}

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search invoice ID (e.g. 000003) or customer…"
            className="pl-8"
            aria-label="Search invoices"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as InvoiceStatus | "ALL")}
          aria-label="Filter by status"
          className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "ALL" ? "All statuses" : STATUS_LABEL(s)}
            </option>
          ))}
        </select>
        <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="Invoice date from" className={DATE_CLS} />
        <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="Invoice date to" className={DATE_CLS} />
      </div>

      {list.error ? (
        <ErrorState message={list.error.message} onRetry={list.reload} />
      ) : !list.data || (list.loading && list.data.length === 0) ? (
        <LoadingRows rows={8} />
      ) : list.data.length === 0 ? (
        <EmptyState
          title={filtered ? "No invoices match your search" : "No invoices yet"}
          description={
            filtered
              ? "Try a different invoice ID, customer name, status or date range."
              : "Create the first Pro Forma Invoice for this branch."
          }
          action={
            filtered ? (
              <Button
                variant="outline"
                onClick={() => {
                  setQuery("");
                  setStatus("ALL");
                  setFrom("");
                  setTo("");
                }}
              >
                Clear filters
              </Button>
            ) : (
              <Link href="/invoices/new" className={buttonVariants()}>
                New Pro Forma
              </Link>
            )
          }
        />
      ) : (
        <div className={`rounded-lg border bg-card transition-opacity ${list.loading ? "opacity-60" : ""}`}>
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/60 hover:bg-secondary/60">
                <TableHead className="px-4">Invoice ID</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Created by</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="px-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="px-4 font-mono font-medium">
                    <Link href={`/invoices/${inv.id}`} className="text-primary hover:underline">
                      {inv.invoiceNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{formatInvoiceDate(inv.invoiceDate)}</TableCell>
                  <TableCell className="max-w-64 truncate">{inv.customer.companyName}</TableCell>
                  <TableCell>{session?.branch.name}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatRupees(inv.totals.roundedTotal)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={inv.status} />
                  </TableCell>
                  <TableCell data-testid="payment-cell">
                    <PaymentBadge invoice={inv} />
                  </TableCell>
                  <TableCell>{inv.createdBy}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(inv.updatedAt)}</TableCell>
                  <TableCell className="px-4">
                    <div className="flex justify-end gap-1.5">
                      <Link
                        href={`/invoices/${inv.id}`}
                        className={buttonVariants({ variant: "outline", size: "icon-sm" })}
                        aria-label={`View ${inv.invoiceNumber}`}
                      >
                        <Eye />
                      </Link>
                      <Link
                        href={`/invoices/${inv.id}/edit`}
                        className={buttonVariants({ variant: "outline", size: "icon-sm" })}
                        aria-label={`Edit ${inv.invoiceNumber}`}
                      >
                        <Pencil />
                      </Link>
                      <DownloadButton invoice={inv} disabled={inv.status === "DRAFT" && API_MODE} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">
            {list.data.length} invoice{list.data.length === 1 ? "" : "s"}
          </p>
        </div>
      )}
    </div>
  );
}
