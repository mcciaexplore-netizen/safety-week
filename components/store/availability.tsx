"use client";

import { MapPin, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ENQUIRY_PHONE, ENQUIRY_PHONE_SPACED, type Availability, type Branch } from "@/lib/store/client";
import { BranchSelect } from "./bits";

/** Opens the phone's dialer on a mobile; on a laptop the number is right there on the button. */
export function EnquireButton({ className }: { className?: string }) {
  return (
    <a href={`tel:+91${ENQUIRY_PHONE}`} data-testid="enquire-now" aria-label={`Enquire now: call ${ENQUIRY_PHONE_SPACED}`}
      className={"inline-flex items-center gap-2 rounded-lg bg-brand-gradient px-3 py-1.5 text-xs font-semibold text-white shadow-btn transition-all duration-300 hover:-translate-y-0.5 hover:shadow-btn-hover " + (className ?? "")}>
      <Phone className="size-3.5" />Enquire now · {ENQUIRY_PHONE_SPACED}
    </a>
  );
}

/** Shown when a shopper asks for more than the chosen branch really has: the live number, and other branches with theirs. */
export function AvailabilityNotice({ info, branchName, onSwitch, className, adjusted = true }: { info: Availability; branchName: string; onSwitch: (code: string) => void; className?: string; adjusted?: boolean }) {
  const none = info.available === 0;
  return (
    <div role="alert" data-testid="availability-notice" className={"rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-foreground " + (className ?? "")}>
      <p className="font-semibold text-warning">
        {none ? `Out of stock at ${branchName}.` : `Only ${info.available} available at ${branchName}.`}
        {!none && <span className="font-normal text-muted-foreground">{adjusted ? ` We have set your quantity to ${info.available}.` : ` Please reduce the quantity to ${info.available} or less.`}</span>}
      </p>
      {info.options.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          <p className="text-muted-foreground">Want {info.wanted}? Collect from another branch (live stock):</p>
          <ul className="flex flex-wrap gap-1.5">
            {info.options.map((o) => (
              <li key={o.code}>
                <Button type="button" size="xs" variant="outline" onClick={() => onSwitch(o.code)} data-testid={`switch-${o.code}`}>
                  <MapPin data-icon="inline-start" />{o.name} · {o.available} available{!o.enough ? " (not enough)" : ""}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-1 text-muted-foreground">No other branch has this item in stock right now.</p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <EnquireButton />
        <span className="text-muted-foreground">Call the MCCIA office to arrange this purchase.</span>
      </div>
    </div>
  );
}

/** Asks the shopper to choose a pick-up branch first (we need it to read the right stock). */
export function ChooseBranchFirst({ branches, onPick, className }: { branches: Branch[]; onPick: (code: string) => void; className?: string }) {
  return (
    <div role="alert" data-testid="choose-branch" className={"rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs " + (className ?? "")}>
      <p className="mb-2 font-semibold text-primary">Choose where you will collect from first, so we can check live stock:</p>
      <BranchSelect branches={branches} value={null} onChange={onPick} className="w-full" />
    </div>
  );
}
