"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Pencil, Printer } from "lucide-react";
import { DownloadButton } from "@/components/app/download-button";
import { InvoiceAdminPanel } from "@/components/app/invoice-admin-panel";
import { PageHeader } from "@/components/app/page-header";
import { ErrorState, LoadingRows } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { InvoicePaper, PaperFrame } from "@/components/invoice/invoice-paper";
import { Button, buttonVariants } from "@/components/ui/button";
import { useAsync } from "@/hooks/use-async";
import { useSession } from "@/hooks/use-session";
import { invoiceToView } from "@/lib/invoice/model";
import { API_MODE, services } from "@/lib/services";

export function InvoiceDetailView({ id }: { id: string }) {
  const { session } = useSession();
  const data = useAsync(async () => {
    const [invoice, products] = await Promise.all([
      services.invoices.get(id),
      services.catalog.listProducts(),
    ]);
    return { invoice, products };
  }, `invoice:${session?.branch.id}:${id}`);
  const inv = data.data?.invoice;
  const isAdmin = API_MODE && !!session && session.user.role !== "BRANCH_USER";

  // ?print=1 (the history "Download" action) opens the browser print dialog: Save as PDF.
  useEffect(() => {
    if (inv && new URLSearchParams(window.location.search).has("print")) window.print();
  }, [inv]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link
        href="/invoices"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden"
      >
        <ArrowLeft className="size-4" />
        Back to invoices
      </Link>

      {data.error ? (
        <ErrorState
          title="Invoice not available"
          message={data.error.message}
          onRetry={data.reload}
          action={
            <Link href="/invoices" className={buttonVariants({ variant: "outline" })}>
              All invoices
            </Link>
          }
        />
      ) : !inv || !data.data ? (
        <LoadingRows rows={7} />
      ) : (
        <>
          <div className="print:hidden">
            <PageHeader
              eyebrow="Pro Forma Invoice"
              title={inv.invoiceNumber}
              description={`${inv.customer.companyName} · version ${inv.version}`}
              actions={
                <>
                  <StatusBadge status={inv.status} />
                  <Button variant="outline" onClick={() => window.print()}>
                    <Printer data-icon="inline-start" />
                    Print
                  </Button>
                  <DownloadButton invoice={inv} label="Download PDF" disabled={inv.status === "DRAFT" && API_MODE} />
                  {inv.status !== "CANCELLED" && (
                    <Link href={`/invoices/${inv.id}/edit`} className={buttonVariants()}>
                      <Pencil data-icon="inline-start" />
                      Edit
                    </Link>
                  )}
                </>
              }
            />
          </div>
          {isAdmin && <InvoiceAdminPanel invoice={inv} onChanged={data.reload} />}
          <div className="print-area rounded-md bg-neutral-200 p-2 sm:p-4 print:bg-transparent print:p-0">
            <PaperFrame>
              <InvoicePaper view={invoiceToView(inv)} products={data.data.products} />
            </PaperFrame>
          </div>
        </>
      )}
    </div>
  );
}
