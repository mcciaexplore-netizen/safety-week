import Link from "next/link";
import { ArrowRight, FileText, History, ShieldCheck, Store } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EVENT, ORGANISATION } from "@/lib/config/app-config";
import { BRANCHES } from "@/lib/mock/branches";
import { cn } from "@/lib/utils";

const FEATURES = [
  {
    icon: FileText,
    title: "Editable Pro Forma Invoice",
    text: "Fill the MCCIA invoice in the browser with items, HSN, CGST/SGST and totals calculated for you.",
  },
  {
    icon: History,
    title: "History and revisions",
    text: "Every invoice gets a unique ID. Search, reopen and revise invoices without losing the audit trail.",
  },
  {
    icon: Store,
    title: "Five branch workspaces",
    text: "Each branch works only with its own invoices, from a single shared system.",
  },
  {
    icon: ShieldCheck,
    title: "Built for MCCIA processes",
    text: "Layout, wording and field names follow the existing Pro Forma Invoice format.",
  },
];

export default function LandingPage() {
  return (
    <>
      <section className="border-b bg-sidebar text-sidebar-foreground">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-[1.3fr_1fr] md:py-24">
          <div className="space-y-6">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-accent">
              {ORGANISATION.name}
            </p>
            <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
              National Safety Week {EVENT.year}
              <span className="block text-2xl font-normal text-sidebar-foreground/80 sm:text-3xl">
                Pro Forma Invoice System
              </span>
            </h1>
            <p className="max-w-xl text-base text-sidebar-foreground/80">
              Create, review and track Pro Forma Invoices for safety-awareness material sales across all
              five MCCIA branches.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/national-safety-week-2027"
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "h-11 bg-brand-accent px-5 text-base text-sidebar-primary-foreground hover:bg-brand-accent/90",
                )}
              >
                National Safety Week {EVENT.year}
                <ArrowRight data-icon="inline-end" />
              </Link>
              <Link
                href="/select-branch"
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "h-11 border-sidebar-border bg-transparent px-5 text-base text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                Go straight to branch sign-in
              </Link>
            </div>
          </div>
          <div className="self-center rounded-xl border border-sidebar-border bg-sidebar-accent/50 p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/70">
              Participating branches
            </p>
            <ul className="divide-y divide-sidebar-border">
              {BRANCHES.map((b) => (
                <li key={b.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="font-medium">{b.name}</span>
                  <span className="rounded bg-sidebar px-2 py-0.5 font-mono text-xs text-sidebar-foreground/80">
                    {b.code}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <h2 className="mb-8 text-xl font-semibold">What you can do here</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-lg border bg-card p-5">
              <span className="mb-3 flex size-9 items-center justify-center rounded-md bg-secondary text-primary">
                <Icon className="size-5" />
              </span>
              <h3 className="mb-1 font-medium">{title}</h3>
              <p className="text-sm text-muted-foreground">{text}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
