"use client";

import Link from "next/link";
import { ErrorState } from "@/components/app/states";
import { buttonVariants } from "@/components/ui/button";

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      title="This page could not be displayed"
      message={error.message}
      onRetry={reset}
      action={
        <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>
          Back to dashboard
        </Link>
      }
    />
  );
}
