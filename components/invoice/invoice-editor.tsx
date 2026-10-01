"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ErrorState, LoadingRows } from "@/components/app/states";
import { buttonVariants } from "@/components/ui/button";
import { useAsync } from "@/hooks/use-async";
import { useSession } from "@/hooks/use-session";
import { emptyDraft, invoiceToDraft, type InvoiceDraft } from "@/lib/invoice/model";
import { services } from "@/lib/services";
import type { Product } from "@/lib/types";
import { InvoiceWorkspace } from "./invoice-workspace";

interface Loaded {
  draft: InvoiceDraft;
  products: Product[];
}

/** Loads the catalogue plus either the saved invoice (edit) or a blank draft (new). */
export function InvoiceEditor({ id }: { id?: string }) {
  const { session } = useSession();
  const loaded = useAsync<Loaded>(async () => {
    const [products, draft] = await Promise.all([
      services.catalog.listProducts(),
      id
        ? services.invoices.get(id).then(invoiceToDraft)
        : services.invoices.peekNextNumber().then(emptyDraft),
    ]);
    return { products, draft };
  }, `editor:${session?.branch.id}:${id ?? "new"}`);

  if (loaded.error) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Link
          href="/invoices"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to invoices
        </Link>
        <ErrorState
          title="Invoice not available"
          message={loaded.error.message}
          onRetry={loaded.reload}
          action={
            <Link href="/invoices" className={buttonVariants({ variant: "outline" })}>
              All invoices
            </Link>
          }
        />
      </div>
    );
  }
  if (!loaded.data) {
    return (
      <div className="mx-auto max-w-[1600px] space-y-3" role="status" aria-label="Loading editor">
        <LoadingRows rows={8} />
      </div>
    );
  }
  return <InvoiceWorkspace key={id ?? "new"} initialDraft={loaded.data.draft} products={loaded.data.products} />;
}
