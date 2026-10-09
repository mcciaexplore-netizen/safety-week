"use client";

import { useState } from "react";
import { Clock, SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAsync } from "@/hooks/use-async";
import { API_MODE } from "@/lib/services";
import { api } from "@/lib/services/api";

export interface EditRequest {
  id: string;
  invoice_id: string;
  invoice_number: string;
  company_name: string;
  invoice_status: string;
  branch_code: string;
  branch_name: string;
  requested_by_name: string;
  reason: string;
  status: "OPEN" | "DONE" | "DECLINED";
  resolved_by_name: string;
  resolved_note: string;
  created_at: string;
  resolved_at: string | null;
}

/** The signed-in branch's requests that are still waiting for the central admin (empty outside the live server). */
export function useOpenEditRequests() {
  return useAsync(
    () => (API_MODE ? api<EditRequest[]>("/edit-requests?status=OPEN") : Promise.resolve([] as EditRequest[])),
    "edit-requests:open",
  );
}

/**
 * Branch users and branch admins cannot change a submitted invoice; this asks the central admin to.
 * `pending` = a request for this invoice is already waiting (shown instead of the button).
 */
export function RequestEditButton({
  invoiceId,
  invoiceNumber,
  pending,
  onSent,
  compact = false,
}: {
  invoiceId: string;
  invoiceNumber: string;
  pending: boolean;
  onSent: () => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api<EditRequest>(`/invoices/${invoiceId}/edit-requests`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) });
      setOpen(false);
      setReason("");
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the request.");
    } finally {
      setBusy(false);
    }
  }

  if (pending)
    return compact ? (
      <span className="inline-flex size-7 items-center justify-center text-warning" title="Edit requested — waiting for the central admin" role="img" aria-label={`Edit requested for ${invoiceNumber}`}>
        <Clock className="size-4" />
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-sm font-medium text-warning" data-testid="edit-requested">
        <Clock className="size-4" />
        Edit requested — waiting for the central admin
      </span>
    );

  return (
    <>
      {compact ? (
        <Button variant="outline" size="icon-sm" onClick={() => setOpen(true)} aria-label={`Request edit for ${invoiceNumber}`} title="Request edit">
          <SendHorizontal />
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)} data-testid="request-edit">
          <SendHorizontal data-icon="inline-start" />
          Request edit
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request an edit to {invoiceNumber}</DialogTitle>
            <DialogDescription>
              Only the central admin can change a submitted invoice. Say what needs to change; the central admin will make
              the change or reply with a reason.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="What needs to change"
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. customer wants 500 badges instead of 1000"
            maxLength={1000}
          />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
            <Button disabled={busy || reason.trim().length < 3} onClick={send} data-testid="send-edit-request">
              Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
