"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { EditDialog, str } from "@/components/admin/edit-dialog";
import { PageHeader } from "@/components/app/page-header";
import { ErrorState, LoadingRows } from "@/components/app/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAsync } from "@/hooks/use-async";
import { api } from "@/lib/services/api";

interface Branch { id: string; code: string; name: string; address: string; phone: string; email: string; active: boolean }

export default function BranchesPage() {
  const list = useAsync(() => api<Branch[]>("/admin/branches"), "admin-branches");
  const [editing, setEditing] = useState<Branch | null>(null);

  return (
    <>
      <PageHeader title="Branches" description="The five MCCIA branches are fixed. You can update their contact details or switch one off." />
      {list.error ? <ErrorState message={list.error.message} onRetry={list.reload} /> : !list.data ? <LoadingRows rows={5} /> : (
        <div className="overflow-x-auto rounded-xl glass shadow-card">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left"><tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:font-medium"><th>Code</th><th>Branch</th><th>Address</th><th>Phone</th><th>E-mail</th><th>Status</th><th /></tr></thead>
            <tbody className="[&>tr]:border-t [&_td]:px-4 [&_td]:py-2.5">
              {list.data.map((b) => (
                <tr key={b.id} data-testid="branch-row">
                  <td className="font-mono">{b.code}</td><td className="font-medium">{b.name}</td><td>{b.address || "—"}</td><td>{b.phone || "—"}</td><td>{b.email || "—"}</td>
                  <td>{b.active ? <Badge variant="outline">Active</Badge> : <Badge variant="outline" className="bg-muted">Inactive</Badge>}</td>
                  <td className="text-right"><Button variant="outline" size="icon-sm" aria-label={`Edit ${b.name}`} onClick={() => setEditing(b)}><Pencil /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <EditDialog
          key={editing.id}
          title={`Edit ${editing.name}`}
          description="The branch name and code are fixed."
          fields={[
            { key: "address", label: "Address", type: "textarea" },
            { key: "phone", label: "Phone" },
            { key: "email", label: "E-mail" },
            { key: "active", label: "Branch is active", type: "checkbox" },
          ]}
          initial={{ address: editing.address, phone: editing.phone, email: editing.email, active: editing.active }}
          onSave={async (v) => {
            await api(`/admin/branches/${editing.id}`, { method: "PUT", body: JSON.stringify({ address: str(v.address), phone: str(v.phone), email: str(v.email), active: !!v.active }) });
            list.reload();
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
