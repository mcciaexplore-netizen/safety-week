"use client";

import Link from "next/link";
import { MCCIALogo } from "@/components/brand/logo";
import { buttonVariants } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";
import { EVENT } from "@/lib/config/app-config";
import { cn } from "@/lib/utils";

export function PublicHeader() {
  const { session } = useSession();
  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-3" aria-label="MCCIA Safety Week home">
          <MCCIALogo height={28} />
          <span className="hidden border-l pl-3 text-sm font-medium text-muted-foreground sm:block">
            Safety Week Pro Forma
          </span>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Primary">
          <Link
            href="/national-safety-week-2027"
            className={cn(buttonVariants({ variant: "ghost" }), "hidden sm:inline-flex")}
          >
            NSW {EVENT.year}
          </Link>
          <Link
            href="/select-branch"
            className={cn(buttonVariants({ variant: "ghost" }), "hidden sm:inline-flex")}
          >
            Branches
          </Link>
          {session ? (
            <Link href="/dashboard" className={buttonVariants()}>
              Open {session.branch.name} workspace
            </Link>
          ) : (
            <Link href="/select-branch" className={buttonVariants()}>
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="mt-auto border-t bg-card">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>© Mahratta Chamber of Commerce, Industries and Agriculture · MCCIA Trade Tower, Senapati Bapat Road, Pune</p>
        <p>Prototype build — demo data only. No real invoices are created.</p>
      </div>
    </footer>
  );
}
