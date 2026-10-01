"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { EditDialog, orNull, str, type FieldSpec } from "@/components/admin/edit-dialog";
import { PageHeader } from "@/components/app/page-header";
import { ErrorState, LoadingRows } from "@/components/app/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAsync } from "@/hooks/use-async";
import { resetInvoiceHeader } from "@/hooks/use-invoice-header";
import { api } from "@/lib/services/api";

interface Event { id: string; name: string; year: number; invoice_prefix: string; start_date: string | null; end_date: string | null; status: string; notes: string; has_invoices: boolean; unconfirmed_products: number }
interface Header { title: string; name: string; address_lines: string[]; gstin: string; pan: string; for_org: string; signatory: string }

export default function EventPage() {
  const events = useAsync(() => api<Event[]>("/admin/events"), "admin-events");
  const header = useAsync(() => api<Header>("/settings/invoice"), "admin-header");
  const [editEvent, setEditEvent] = useState<Event | null>(null);
  const [editHeader, setEditHeader] = useState(false);
  const e = events.data?.[0];

  const eventFields: FieldSpec[] = [
    { key: "name", label: "Event name" },
    { key: "year", label: "Event year", type: "number", step: "1" },
    { key: "start_date", label: "Start date", type: "date" },
    { key: "end_date", label: "End date", type: "date" },
    { key: "invoice_prefix", label: "Invoice number prefix", disabled: !!e?.has_invoices, hint: e?.has_invoices ? "Locked: invoices already use it." : "Letters and digits, e.g. NSW27." },
    { key: "status", label: "Status", type: "select", options: [["PLANNING", "Planning"], ["OPEN", "Open (invoicing live)"], ["CLOSED", "Closed"]],
      hint: "Open needs dates and every rate confirmed." },
    { key: "notes", label: "Notes", type: "textarea" },
  ];

  return (
    <>
      <PageHeader title="Event configuration" description="The campaign year, dates and invoice numbering, plus the header and footer printed on every invoice." />
      {events.error ? <ErrorState message={events.error.message} onRetry={events.reload} /> : !e ? <LoadingRows rows={4} /> : (
        <section className="space-y-3 rounded-lg border bg-card p-5" aria-label="Event">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{e.name} {e.year} <Badge variant="outline" className="ml-2">{e.status}</Badge></h2>
              <p className="text-sm text-muted-foreground">Invoice numbers look like <span className="font-mono">{e.invoice_prefix}-TIL-000001</span></p>
            </div>
            <Button variant="outline" onClick={() => setEditEvent(e)}><Pencil data-icon="inline-start" />Edit event</Button>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-muted-foreground">Start</dt><dd className="font-medium" data-testid="event-start">{e.start_date ?? "Not set"}</dd></div>
            <div><dt className="text-muted-foreground">End</dt><dd className="font-medium">{e.end_date ?? "Not set"}</dd></div>
            <div><dt className="text-muted-foreground">Rates awaiting confirmation</dt><dd className="font-medium">{e.unconfirmed_products}</dd></div>
          </dl>
          {e.notes && <p className="text-sm text-muted-foreground">{e.notes}</p>}
        </section>
      )}

      {header.error ? <ErrorState message={header.error.message} onRetry={header.reload} /> : !header.data ? null : (
        <section className="space-y-3 rounded-lg border bg-card p-5" aria-label="Invoice header and footer">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Invoice header and footer</h2>
              <p className="text-sm text-muted-foreground">Used by the live preview, print and every newly generated PDF. PDFs already issued do not change.</p>
            </div>
            <Button variant="outline" onClick={() => setEditHeader(true)}><Pencil data-icon="inline-start" />Edit</Button>
          </div>
          <div className="rounded-md border bg-background p-4 text-sm leading-snug">
            <p className="text-center font-bold">{header.data.title}</p>
            <p className="mt-2 font-semibold">{header.data.name}</p>
            {header.data.address_lines.map((l, i) => <p key={i} className="whitespace-pre">{l}</p>)}
            <p className="font-semibold">GSTIN - {header.data.gstin}   PAN - {header.data.pan}</p>
            <p className="mt-3 text-muted-foreground">Footer: “{header.data.for_org}” … “{header.data.signatory}”</p>
          </div>
        </section>
      )}

      {editEvent && (
        <EditDialog
          key={editEvent.id}
          title="Edit event"
          fields={eventFields}
          initial={{ name: editEvent.name, year: String(editEvent.year), start_date: editEvent.start_date ?? "", end_date: editEvent.end_date ?? "", invoice_prefix: editEvent.invoice_prefix, status: editEvent.status, notes: editEvent.notes }}
          onSave={async (v) => {
            await api(`/admin/events/${editEvent.id}`, { method: "PUT", body: JSON.stringify({ name: str(v.name), year: Number(v.year), start_date: orNull(v.start_date), end_date: orNull(v.end_date), invoice_prefix: str(v.invoice_prefix), status: v.status, notes: str(v.notes) }) });
            events.reload();
          }}
          onClose={() => setEditEvent(null)}
        />
      )}
      {editHeader && header.data && (
        <EditDialog
          title="Invoice header and footer"
          description="Keep the double spaces in the address lines if you want them printed exactly as in the workbook."
          fields={[
            { key: "title", label: "Title" }, { key: "name", label: "Organisation name" },
            { key: "address_lines", label: "Address lines (one per line)", type: "textarea" },
            { key: "gstin", label: "GSTIN" }, { key: "pan", label: "PAN" },
            { key: "for_org", label: "Footer: “For …” text" }, { key: "signatory", label: "Footer: signatory label" },
          ]}
          initial={{ ...header.data, address_lines: header.data.address_lines.join("\n") }}
          onSave={async (v) => {
            await api("/admin/settings/invoice", { method: "PUT", body: JSON.stringify({ title: str(v.title), name: str(v.name), address_lines: String(v.address_lines).split("\n").filter((l) => l.trim()), gstin: str(v.gstin).toUpperCase(), pan: str(v.pan).toUpperCase(), for_org: str(v.for_org), signatory: str(v.signatory) }) });
            resetInvoiceHeader();
            header.reload();
          }}
          onClose={() => setEditHeader(false)}
        />
      )}
    </>
  );
}
