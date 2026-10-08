"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { RazorpayCollect, useRazorpayEnabled } from "@/components/app/razorpay-collect";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatRupees } from "@/lib/format";
import { api } from "@/lib/services/api";

const SELECT = "h-9 w-full rounded-lg border border-input bg-white px-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/10";

/**
 * Hand an online order to the customer. Already paid online: just confirm. Pay at pick-up: take the payment first -
 * Cash, or Razorpay UPI (a QR for the exact amount; "Confirm" only opens once Razorpay says the money arrived).
 */
export function PickupDialog({ order, onClose, onDone }: { order: { id: string; number: string; total: string; payment_status: string; customer: { name: string } }; onClose: () => void; onDone: () => void }) {
  const rzp = useRazorpayEnabled();
  const prepaid = order.payment_status === "PAID";
  const [mode, setMode] = useState<"CASH" | "RAZORPAY">("CASH");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = Number(order.total);
  const needsQr = !prepaid && mode === "RAZORPAY" && rzp;
  const canConfirm = prepaid || mode === "CASH" || !rzp || /^pay_/.test(reference);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await api(`/store-orders/${order.id}/pickup`, { method: "POST", body: JSON.stringify(prepaid ? {} : { payment_mode: mode, reference: mode === "RAZORPAY" ? reference.trim() : "" }) });
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the hand-over.");
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Hand over {order.number}</DialogTitle>
          <DialogDescription>{prepaid ? "Already paid online - just confirm the hand-over." : `Collect ${formatRupees(amount)} from ${order.customer.name}.`}</DialogDescription>
        </DialogHeader>
        {!prepaid && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pk-mode">How did the customer pay?</Label>
              <select id="pk-mode" className={SELECT} value={mode} onChange={(e) => { setMode(e.target.value as "CASH" | "RAZORPAY"); setReference(""); }}>
                <option value="CASH">Cash</option>
                <option value="RAZORPAY">Razorpay UPI</option>
              </select>
            </div>
            {needsQr && <RazorpayCollect amount={amount} paidId={reference} onPaid={setReference} />}
            {mode === "RAZORPAY" && !rzp && (
              <div className="space-y-1.5">
                <Label htmlFor="pk-ref">Razorpay payment ID (optional)</Label>
                <Input id="pk-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="pay_…" />
              </div>
            )}
          </div>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" disabled={busy} />}>Cancel</DialogClose>
          <Button onClick={confirm} disabled={busy || !canConfirm} data-testid="confirm-handover">
            {busy && <Loader2 className="animate-spin" data-icon="inline-start" />}Confirm hand-over
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
