"use client";

import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Availability, Branch } from "@/lib/store/client";
import { BranchSelect } from "./bits";

/** Shown when a shopper asks for more than the chosen branch really has: the live number, and other branches with theirs. */
export function AvailabilityNotice({ info, branchName, onSwitch, className }: { info: Availability; branchName: string; onSwitch: (code: string) => void; className?: string }) {
  const none = info.available === 0;
  return (
    <div role="alert" data-testid="availability-notice" className={"rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-foreground " + (className ?? "")}>
      <p className="font-semibold text-warning">
        {none ? `Out of stock at ${branchName}.` : `Only ${info.available} available at ${branchName}.`}
        {!none && <span className="font-normal text-muted-foreground"> We have set your quantity to {info.available}.</span>}
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
