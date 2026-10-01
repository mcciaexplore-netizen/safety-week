import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarClock, Package, Percent } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EVENT } from "@/lib/config/app-config";
import { PRODUCTS } from "@/lib/mock/products";

export const metadata: Metadata = { title: "National Safety Week 2027" };

const STEPS = [
  { title: "Select your branch", text: "Choose one of the five MCCIA branches." },
  { title: "Sign in", text: "Sign in to your branch workspace." },
  { title: "Create a Pro Forma", text: "Add customer details and materials; totals update as you type." },
  { title: "Review and download", text: "Check the live invoice preview, save, and download the PDF." },
];

const CATEGORIES = [
  "Badges & ball pens",
  "Banners (cloth, flex, PPE)",
  "Caps, T-shirts & flags",
  "Oaths, posters & slogans",
  "Scrolls (PPE, security, Do’s & Don’ts)",
  "Pocket books, guides & calendars",
  "Danglers, vehicle stickers",
  "Coffee mugs & water bottles",
];

export default function NationalSafetyWeekPage() {
  const dates =
    EVENT.startDate && EVENT.endDate
      ? `${EVENT.startDate} to ${EVENT.endDate}`
      : "Dates to be announced";
  return (
    <div className="mx-auto max-w-6xl space-y-12 px-4 py-12 sm:px-6">
      <header className="max-w-3xl space-y-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          MCCIA · Safety awareness campaign
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">
          National Safety Week {EVENT.year}
        </h1>
        <p className="text-lg text-muted-foreground">
          Industries across the region order safety-awareness material — banners, badges, caps, posters,
          T-shirts and more — through MCCIA branches. This system prepares the Pro Forma Invoice for each
          order.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link href="/select-branch" className={buttonVariants({ size: "lg" })}>
            Continue to branch selection
            <ArrowRight data-icon="inline-end" />
          </Link>
          <Link href="/" className={buttonVariants({ variant: "outline", size: "lg" })}>
            Back to home
          </Link>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border bg-card p-5">
          <CalendarClock className="mb-3 size-5 text-primary" />
          <p className="text-sm text-muted-foreground">Campaign dates</p>
          <p className="text-lg font-semibold">{dates}</p>
          <p className="mt-1 text-xs text-muted-foreground">Set in event configuration once confirmed.</p>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <Package className="mb-3 size-5 text-primary" />
          <p className="text-sm text-muted-foreground">Material catalogue</p>
          <p className="text-lg font-semibold">{PRODUCTS.length} invoice line items</p>
          <p className="mt-1 text-xs text-muted-foreground">2027 rates are configured before launch.</p>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <Percent className="mb-3 size-5 text-primary" />
          <p className="text-sm text-muted-foreground">Tax</p>
          <p className="text-lg font-semibold">CGST + SGST</p>
          <p className="mt-1 text-xs text-muted-foreground">Applied per item by HSN code.</p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">How it works</h2>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-lg border bg-card p-5">
              <span className="mb-3 flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                {i + 1}
              </span>
              <p className="font-medium">{s.title}</p>
              <p className="text-sm text-muted-foreground">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Materials covered</h2>
        <ul className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <li key={c} className="rounded-full border bg-card px-3 py-1.5 text-sm">
              {c}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
