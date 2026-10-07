import type { Metadata } from "next";
import { StoreShell } from "@/components/store/shell";

export const metadata: Metadata = {
  title: { default: "MCCIA Store — Safety Week merchandise", template: "%s · MCCIA Store" },
  description: "Order MCCIA National Safety Week merchandise online and collect it from your nearest MCCIA branch.",
};

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return <StoreShell>{children}</StoreShell>;
}
