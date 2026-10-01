"use client";

import Link from "next/link";
import { PackageSearch } from "lucide-react";
import { ErrorState, LoadingRows } from "@/components/app/states";
import { Badge } from "@/components/ui/badge";
import { useAsync } from "@/hooks/use-async";
import { useSession } from "@/hooks/use-session";
import { formatNumber } from "@/lib/format";
import { API_MODE } from "@/lib/services";
import { api } from "@/lib/services/api";
import { cn } from "@/lib/utils";

interface Low {
  configured: number;
  total: number;
  low_count: number;
  items: { product_id: string; name: string; remaining: number; low_threshold: number; status: "LOW" | "OUT" }[];
}

/** Dashboard card: which materials are running low (or out) in this branch. Replaces "Recent invoices". */
export function LowStockCard() {
  const { session } = useSession();
  const isAdmin = !!session && session.user.role !== "BRANCH_USER";
  const low = useAsync(() => (API_MODE ? api<Low>("/stock/low?limit=8") : Promise.resolve(null)), `low-stock:${session?.user.id}`);

  return (
    <div className="rounded-lg border bg-card lg:col-span-2" data-testid="low-stock-card">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <h2 className="flex items-center gap-2 font-medium">
          <PackageSearch className="size-4 text-muted-foreground" />
          Low stock materials
        </h2>
        {isAdmin && API_MODE && (
          <Link href="/stock" className="text-sm font-medium text-primary hover:underline">
            Manage stock
          </Link>
        )}
      </div>
      <div className="p-5">
        {!API_MODE ? (
          <p className="text-sm text-muted-foreground">Stock tracking is available with the live backend.</p>
        ) : low.error ? (
          <ErrorState message={low.error.message} onRetry={low.reload} />
        ) : !low.data ? (
          <LoadingRows rows={3} />
        ) : low.data.configured === 0 ? (
          <p className="text-sm text-muted-foreground">
            No stock has been set up for this branch yet.{" "}
            {isAdmin ? (
              <Link href="/stock" className="font-medium text-primary hover:underline">Enter opening stock</Link>
            ) : (
              "Ask your branch admin to enter the opening stock."
            )}
          </p>
        ) : low.data.items.length === 0 ? (
          <p className="text-sm text-emerald-700">All {low.data.configured} tracked materials are well stocked.</p>
        ) : (
          <ul className="divide-y">
            {low.data.items.map((i) => (
              <li key={i.product_id} className="flex items-center justify-between gap-3 py-2 text-sm" data-testid="low-stock-row">
                <span className="truncate">{i.name}</span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="tabular-nums text-muted-foreground">
                    {i.status === "OUT" ? "none left" : `${formatNumber(i.remaining)} left`}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(i.status === "OUT" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800")}
                  >
                    {i.status === "OUT" ? "Out" : "Low"}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
