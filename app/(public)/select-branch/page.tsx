"use client";

import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import { ErrorState, LoadingRows } from "@/components/app/states";
import { useAsync } from "@/hooks/use-async";
import { useSession } from "@/hooks/use-session";
import { API_MODE } from "@/lib/services";
import { services } from "@/lib/services";

export default function SelectBranchPage() {
  const branches = useAsync(() => services.branches.list(), "branches");
  const { session } = useSession();

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-12 sm:px-6">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Step 1 of 2
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Select your branch</h1>
        <p className="text-muted-foreground">
          Choose the MCCIA branch you work for. You will sign in to that branch’s workspace and see only
          its invoices.
        </p>
      </header>

      {session && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/20 bg-secondary px-4 py-3 text-sm">
          <span>
            You are signed in to <strong>{session.branch.name}</strong>.
          </span>
          <Link href="/dashboard" className="font-medium text-primary underline-offset-4 hover:underline">
            Continue to dashboard
          </Link>
        </div>
      )}

      {API_MODE && (
        <p className="text-sm text-muted-foreground">
          MCCIA head office?{" "}
          <Link href="/login?branch=ADMIN" className="font-medium text-primary hover:underline">
            Central admin sign-in
          </Link>
        </p>
      )}

      {branches.loading && !branches.data && <LoadingRows rows={5} />}
      {branches.error && (
        <ErrorState
          title="Could not load branches"
          message={branches.error.message}
          onRetry={branches.reload}
        />
      )}
      {branches.data && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {branches.data.map((b) => (
            <li key={b.id}>
              <Link
                href={`/login?branch=${b.code}`}
                className="group flex h-full items-center justify-between gap-4 rounded-xl glass shadow-card p-5 card-lift focus-visible:outline-2 focus-visible:outline-ring"
              >
                <div className="space-y-1">
                  <p className="text-lg font-semibold">{b.name}</p>
                  <p className="flex items-center gap-1 text-sm text-muted-foreground">
                    <MapPin className="size-3.5" />
                    {b.address}
                  </p>
                  <span className="inline-block rounded bg-secondary px-2 py-0.5 font-mono text-xs">
                    {b.code}
                  </span>
                </div>
                <ArrowRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
