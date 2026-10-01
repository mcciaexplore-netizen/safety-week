"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  FilePlus2,
  LayoutDashboard,
  BarChart3,
  Building2,
  CalendarCog,
  LayoutGrid,
  ListChecks,
  Boxes,
  Package,
  Percent,
  ScrollText,
  Users,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Repeat,
  X,
} from "lucide-react";
import { MCCIALogo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/hooks/use-session";
import { EVENT } from "@/lib/config/app-config";
import { API_MODE, services } from "@/lib/services";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/invoices", label: "Invoices", icon: ListChecks },
  { href: "/invoices/new", label: "New Pro Forma", icon: FilePlus2 },
];
const ADMIN_NAV = [
  { href: "/stock", label: "Stock", icon: Boxes },
  { href: "/admin/audit-logs", label: "Audit log", icon: ScrollText },
];
/** The central admin's whole sidebar (they have no branch, so no branch dashboard or new-invoice screens). */
const SUPER_NAV = [
  { href: "/admin", label: "Overview", icon: LayoutGrid },
  { href: "/admin/branches", label: "Branches", icon: Building2 },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/invoices", label: "Invoices", icon: ListChecks },
  { href: "/admin/products", label: "Products", icon: Package },
  { href: "/stock", label: "Stock", icon: Boxes },
  { href: "/admin/event", label: "Event configuration", icon: CalendarCog },
  { href: "/admin/discounts", label: "Discounts and packages", icon: Percent },
  { href: "/admin/reports", label: "Reports", icon: BarChart3 },
  { href: "/admin/audit-logs", label: "Audit logs", icon: ScrollText },
];

const COLLAPSE_KEY = "nsw27.sidebar.collapsed";

function isActive(pathname: string, href: string) {
  if (href.startsWith("/admin")) return pathname === href;
  if (href === "/invoices") {
    return pathname === "/invoices" || (pathname.startsWith("/invoices/") && pathname !== "/invoices/new");
  }
  return pathname === href;
}

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const { session, ready } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Sidebar: collapsible, remembered, and ALWAYS collapsed while filling in an invoice so the sheet gets the room.
  const [pref, setPref] = useState<boolean>(() => {
    try { return window.localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
  });
  const [override, setOverride] = useState<{ path: string; collapsed: boolean } | null>(null);
  const onInvoiceForm = pathname === "/invoices/new" || /^\/invoices\/[^/]+\/edit$/.test(pathname);
  const collapsed = override?.path === pathname ? override.collapsed : onInvoiceForm || pref;
  function toggleSidebar() {
    if (onInvoiceForm) setOverride({ path: pathname, collapsed: !collapsed }); // just for this page visit
    else {
      setPref(!collapsed);
      try { window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "0" : "1"); } catch { /* ignore */ }
    }
  }

  useEffect(() => {
    if (ready && !session) router.replace("/select-branch");
  }, [ready, session, router]);

  if (!ready || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8" role="status" aria-label="Loading workspace">
        <div className="w-full max-w-md space-y-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  async function signOut() {
    await services.auth.signOut();
    router.push("/");
  }

  const renderSidebar = (compact: boolean) => (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className={cn("space-y-4 border-b border-sidebar-border", compact ? "p-2" : "p-4")}>
        <Link href="/dashboard" onClick={() => setOpen(false)} className="block w-fit rounded bg-white p-2" title="Dashboard">
          <MCCIALogo height={compact ? 14 : 24} className={compact ? "max-w-10" : undefined} />
        </Link>
        {compact ? (
          <p className="text-center font-mono text-xs text-brand-accent" title={session.branch.name}>{session.branch.code}</p>
        ) : (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/60">Active branch</p>
            <p className="text-lg font-semibold leading-tight">{session.branch.name}</p>
            <p className="font-mono text-xs text-brand-accent">{session.branch.code}</p>
          </div>
        )}
      </div>
      <nav className={cn("flex-1 space-y-1", compact ? "p-2" : "p-3")} aria-label="Workspace">
        {(session.user.role === "SUPER_ADMIN" ? SUPER_NAV : [...NAV, ...(API_MODE && session.user.role !== "BRANCH_USER" ? ADMIN_NAV : [])]).map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            aria-current={isActive(pathname, href) ? "page" : undefined}
            title={compact ? label : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent",
              compact ? "justify-center px-0" : "px-3",
              isActive(pathname, href) && "bg-sidebar-accent text-sidebar-accent-foreground border-l-3 border-brand-accent",
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className={compact ? "sr-only" : undefined}>{label}</span>
          </Link>
        ))}
      </nav>
      <div className={cn("space-y-1 border-t border-sidebar-border", compact ? "p-2" : "p-3")}>
        <Link
          href="/select-branch"
          title={compact ? "Switch branch" : undefined}
          className={cn("flex items-center gap-3 rounded-md py-2 text-sm hover:bg-sidebar-accent", compact ? "justify-center px-0" : "px-3")}
        >
          <Repeat className="size-4 shrink-0" />
          <span className={compact ? "sr-only" : undefined}>Switch branch</span>
        </Link>
        <button
          type="button"
          onClick={signOut}
          title={compact ? "Sign out" : undefined}
          className={cn("flex w-full items-center gap-3 rounded-md py-2 text-left text-sm hover:bg-sidebar-accent", compact ? "justify-center px-0" : "px-3")}
        >
          <LogOut className="size-4 shrink-0" />
          <span className={compact ? "sr-only" : undefined}>Sign out</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <aside
        data-testid="sidebar"
        data-collapsed={collapsed ? "1" : "0"}
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 border-r border-sidebar-border transition-[width] duration-200 lg:block",
          collapsed ? "w-16" : "w-64",
        )}
      >
        {renderSidebar(collapsed)}
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw]">{renderSidebar(false)}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X /> : <Menu />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            data-testid="sidebar-toggle"
            onClick={toggleSidebar}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
          <div className="min-w-0 flex-1 truncate text-sm">
            <span className="font-semibold">{session.branch.name}</span>
            <span className="text-muted-foreground">
              {" "}
              · National Safety Week {EVENT.year}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-sm font-medium">{session.user.name}</p>
              <p className="text-xs text-muted-foreground">Branch user</p>
            </div>
            <span
              aria-hidden
              className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
            >
              {session.user.name
                .split(" ")
                .map((p) => p[0])
                .join("")
                .slice(0, 2)}
            </span>
          </div>
        </header>
        <div className="border-b bg-amber-50 px-4 py-1.5 text-center text-xs text-amber-900 sm:px-6">
          {API_MODE ? "Development build — connected to the local API." : "Demo mode — sample data stored in this browser only."}
        </div>
        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
