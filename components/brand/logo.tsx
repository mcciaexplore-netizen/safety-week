import Image from "next/image";
import { cn } from "@/lib/utils";

/** MCCIA logo (public/brand/mccia-logo.png; the API keeps a copy for the PDF in api/app/assets/logo.png). */
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
