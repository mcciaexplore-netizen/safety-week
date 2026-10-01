"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface FieldSpec {
  key: string;
  label: string;
  type?: "text" | "textarea" | "number" | "date" | "select" | "checkbox";
  options?: [value: string, label: string][];
  hint?: string;
  disabled?: boolean;
  step?: string;
  wide?: boolean;
}
export type Values = Record<string, string | boolean>;

const SELECT_CLS =
  "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * One form dialog for every admin screen. Mount it only while editing (`{editing && <EditDialog key=… />}`)
 * so its state starts from `initial` each time. `onSave` may throw; the message is shown in the dialog.
 */
export function EditDialog({
  title,
  description,
  fields,
  initial,
  submitLabel = "Save",
  onSave,
  onClose,
}: {
  title: string;
  description?: string;
  fields: FieldSpec[];
  initial: Values;
  submitLabel?: string;
  onSave: (values: Values) => Promise<void>;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Values>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: string, v: string | boolean) => setValues((cur) => ({ ...cur, [key]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave(values);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((f) => {
              const id = `f-${f.key}`;
              const v = values[f.key];
              return (
                <div key={f.key} className={cn("space-y-1.5", (f.wide || f.type === "textarea") && "sm:col-span-2")}>
                  {f.type === "checkbox" ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input id={id} type="checkbox" checked={!!v} disabled={f.disabled} onChange={(e) => set(f.key, e.target.checked)} />
                      {f.label}
                    </label>
                  ) : (
                    <>
                      <Label htmlFor={id}>{f.label}</Label>
                      {f.type === "textarea" ? (
                        <Textarea id={id} rows={3} value={String(v ?? "")} disabled={f.disabled} onChange={(e) => set(f.key, e.target.value)} />
                      ) : f.type === "select" ? (
                        <select id={id} className={SELECT_CLS} value={String(v ?? "")} disabled={f.disabled} onChange={(e) => set(f.key, e.target.value)}>
                          {f.options?.map(([val, label]) => (
                            <option key={val} value={val}>{label}</option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          id={id}
                          type={f.type ?? "text"}
                          step={f.type === "number" ? (f.step ?? "any") : undefined}
                          value={String(v ?? "")}
                          disabled={f.disabled}
                          onChange={(e) => set(f.key, e.target.value)}
                        />
                      )}
                    </>
                  )}
                  {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
                </div>
              );
            })}
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={busy} />}>Cancel</DialogClose>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" data-icon="inline-start" />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "" -> null, otherwise the trimmed string. */
export const orNull = (v: string | boolean | undefined) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
export const str = (v: string | boolean | undefined) => (typeof v === "string" ? v.trim() : "");
