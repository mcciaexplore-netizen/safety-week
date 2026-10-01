"use client";

import { useState } from "react";
import { Pencil, UserPlus } from "lucide-react";
import { EditDialog, orNull, str, type FieldSpec } from "@/components/admin/edit-dialog";
import { PageHeader } from "@/components/app/page-header";
import { ErrorState, LoadingRows } from "@/components/app/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAsync } from "@/hooks/use-async";
import { api } from "@/lib/services/api";

interface User { id: string; name: string; email: string; role: string; branch_code: string | null; active: boolean }
const ROLES: [string, string][] = [["BRANCH_USER", "Branch user"], ["BRANCH_ADMIN", "Branch admin"], ["SUPER_ADMIN", "Central admin"]];
const BRANCHES: [string, string][] = [["", "— none (central admin) —"], ["SBR", "SB Road"], ["TIL", "Tilak Road"], ["BHO", "Bhosari"], ["HAD", "Hadapsar"], ["AHL", "Ahilyanagar"]];

export default function UsersPage() {
  const list = useAsync(() => api<User[]>("/admin/users"), "admin-users");
  const [editing, setEditing] = useState<User | "new" | null>(null);
  const isNew = editing === "new";
  const user = editing && editing !== "new" ? editing : null;

  const fields: FieldSpec[] = [
    ...(isNew ? [{ key: "email", label: "E-mail (login)", type: "text" as const }] : []),
    { key: "name", label: "Name" },
    { key: "role", label: "Role", type: "select", options: ROLES },
    { key: "branch_code", label: "Branch", type: "select", options: BRANCHES, hint: "Required for branch users and branch admins." },
    ...(isNew ? [{ key: "password", label: "Initial password (min 8)", type: "text" as const, hint: "Needed when creating a login in Supabase." }] : []),
    { key: "active", label: "Account is active", type: "checkbox" },
  ];

  return (
    <>
      <PageHeader title="Users" description="Who can sign in, their role and their branch. Role and branch changes are recorded in the audit log."
        actions={<Button onClick={() => setEditing("new")}><UserPlus data-icon="inline-start" />Add user</Button>} />
      {list.error ? <ErrorState message={list.error.message} onRetry={list.reload} /> : !list.data ? <LoadingRows rows={6} /> : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left"><tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:font-medium"><th>Name</th><th>E-mail</th><th>Role</th><th>Branch</th><th>Status</th><th /></tr></thead>
            <tbody className="[&>tr]:border-t [&_td]:px-4 [&_td]:py-2.5">
              {list.data.map((u) => (
                <tr key={u.id} data-testid="user-row">
                  <td className="font-medium">{u.name}</td><td>{u.email}</td><td>{ROLES.find((r) => r[0] === u.role)?.[1] ?? u.role}</td><td>{u.branch_code ?? "All"}</td>
                  <td>{u.active ? <Badge variant="outline">Active</Badge> : <Badge variant="outline" className="bg-slate-100">Inactive</Badge>}</td>
                  <td className="text-right"><Button variant="outline" size="icon-sm" aria-label={`Edit ${u.name}`} onClick={() => setEditing(u)}><Pencil /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <EditDialog
          key={user?.id ?? "new"}
          title={isNew ? "Add user" : `Edit ${user!.name}`}
          fields={fields}
          initial={isNew ? { email: "", name: "", role: "BRANCH_USER", branch_code: "TIL", password: "", active: true }
            : { name: user!.name, role: user!.role, branch_code: user!.branch_code ?? "", active: user!.active }}
          onSave={async (v) => {
            const body = { name: str(v.name), role: v.role, branch_code: orNull(v.branch_code), active: !!v.active };
            if (isNew) await api("/admin/users", { method: "POST", body: JSON.stringify({ ...body, email: str(v.email), password: orNull(v.password) }) });
            else await api(`/admin/users/${user!.id}`, { method: "PUT", body: JSON.stringify(body) });
            list.reload();
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
