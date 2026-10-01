"use client";

import { usePathname } from "next/navigation";
import { EmptyState } from "@/components/app/states";
import { useSession } from "@/hooks/use-session";
import { API_MODE } from "@/lib/services";

/** Central-admin area. (The audit log is also open to branch admins, who see only their own branch.) */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  const { session } = useSession();
  const pathname = usePathname();
  if (!API_MODE)
    return <EmptyState title="Available with the live backend" description="The admin panel manages the real database; demo mode has none." />;
  const role = session?.user.role;
  // The audit-log page decides for itself (branch admins see their branch; everyone else gets "Admins only").
  const allowed = role === "SUPER_ADMIN" || pathname === "/admin/audit-logs";
  if (!allowed)
    return <EmptyState title="Central admin only" description="Ask the MCCIA central admin if you need access to this page." />;
  return <div className="mx-auto max-w-7xl space-y-6">{children}</div>;
}
