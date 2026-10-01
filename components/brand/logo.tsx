import Image from "next/image";
import { cn } from "@/lib/utils";

/** MCCIA wordmark extracted from the source workbook (low-res; request the original from MCCIA). */
export function MCCIALogo({
  className,
  height = 28,
}: {
  className?: string;
  height?: number;
}) {
  return (
    <Image
      src="/brand/mccia-logo.png"
      alt="MCCIA"
      width={Math.round(height * 3)}
      height={height}
      className={cn("object-contain", className)}
      priority
    />
  );
}
