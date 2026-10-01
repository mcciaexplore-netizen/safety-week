"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { services } from "@/lib/services";

/** One Download action for history rows, the invoice page and the submit dialog. */
export function DownloadButton({
  invoice,
  label,
  disabled,
  version,
}: {
  invoice: { id: string; invoiceNumber: string };
  /** A specific historical version (admin history); default is the current one. */
  version?: number;
  label?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      await services.invoices.downloadPdf(invoice, version);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Could not download the PDF."); // ponytail: no toast system yet
    } finally {
      setBusy(false);
    }
  }
  const Icon = busy ? Loader2 : Download;
  return (
    <Button
      type="button"
      variant="outline"
      size={label ? "default" : "icon-sm"}
      disabled={disabled || busy}
      onClick={run}
      aria-label={`Download PDF for ${invoice.invoiceNumber}${version ? ` version ${version}` : ""}`}
      title="Download PDF"
    >
      <Icon className={busy ? "animate-spin" : undefined} data-icon={label ? "inline-start" : undefined} />
      {label}
    </Button>
  );
}
