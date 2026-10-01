"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Lock } from "lucide-react";
import { ErrorState, LoadingRows } from "@/components/app/states";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAsync } from "@/hooks/use-async";
import { API_MODE, REAL_AUTH, services } from "@/lib/services";
import { CENTRAL_BRANCH } from "@/lib/services/real-auth";

export function LoginForm({ branchCode }: { branchCode: string }) {
  const router = useRouter();
  const central = API_MODE && branchCode === "ADMIN";
  const branch = useAsync(
    () => (central ? Promise.resolve(CENTRAL_BRANCH) : services.branches.getByCode(branchCode)),
    `branch:${branchCode}`,
  );
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState(REAL_AUTH ? "" : "demo1234");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const found = branch.data ?? null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!found) return;
    setSubmitting(true);
    setError(null);
    try {
      const session = await services.auth.signIn({
        branchId: found.id,
        email: email ?? (REAL_AUTH ? "" : services.branches.demoLoginEmail(found.id)),
        password,
      });
      router.push(session.user.role === "SUPER_ADMIN" ? "/admin" : "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1fr_420px]">
      <div className="hidden flex-col justify-center space-y-4 md:flex">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Step 2 of 2
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {found ? `${found.name} branch sign-in` : "Branch sign-in"}
        </h1>
        <p className="text-muted-foreground">
          Sign in to prepare and track Pro Forma Invoices for National Safety Week 2027. Your workspace
          only shows invoices that belong to your branch.
        </p>
        {!REAL_AUTH && <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {API_MODE
            ? "Development sign-in: any password works. Invoices are saved in the local API database."
            : "Demo mode: sign-in is simulated. Any password of 4+ characters works and no data leaves your browser."}
        </p>}
      </div>

      <div className="rounded-xl border bg-card p-6 shadow-sm">
        {branch.loading && !branch.data && <LoadingRows rows={4} />}
        {branch.error && (
          <ErrorState message={branch.error.message} onRetry={branch.reload} />
        )}
        {!branch.loading && !branch.error && !found && (
          <ErrorState
            title="Branch not recognised"
            message="Pick one of the five MCCIA branches to continue."
            action={
              <Link href="/select-branch" className={buttonVariants()}>
                Select branch
              </Link>
            }
          />
        )}
        {found && (
          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Signing in to</p>
              <p className="flex items-center gap-2 text-xl font-semibold">
                {central ? "Central admin" : found.name}
                {!central && (
                  <span className="rounded bg-secondary px-2 py-0.5 font-mono text-xs font-normal">{found.code}</span>
                )}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">User ID / e-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email ?? (REAL_AUTH ? "" : services.branches.demoLoginEmail(found.id))}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="h-10 w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                  Signing in…
                </>
              ) : (
                <>
                  <Lock data-icon="inline-start" />
                  Sign in
                </>
              )}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Wrong branch?{" "}
              <Link href="/select-branch" className="font-medium text-primary hover:underline">
                Change branch
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
