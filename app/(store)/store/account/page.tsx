"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OrderStatusPill } from "@/components/store/bits";
import { useAsync } from "@/hooks/use-async";
import { rupees, storeActions, storeApi, useStore, type Customer, type Order } from "@/lib/store/client";

function SignIn() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function request(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await storeApi("/auth/request-code", { method: "POST", body: JSON.stringify({ email: email.trim() }) }); setSent(true); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not send the code."); }
    finally { setBusy(false); }
  }
  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await storeApi<{ token: string; customer: Customer }>("/auth/verify", { method: "POST", body: JSON.stringify({ email: email.trim(), code: code.trim() }) });
      storeActions.signIn(r.token, r.customer);
      if (next && next.startsWith("/store")) router.push(next);
    } catch (err) { setError(err instanceof Error ? err.message : "That code did not work."); }
    finally { setBusy(false); }
  }

  return (
    <div className="glass mx-auto max-w-md space-y-5 rounded-xl p-6 sm:p-8">
      <div>
        <h1 className="text-3xl font-extrabold">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">No password needed. We e-mail you a 6-digit code. New here? Your account is created automatically. You can also check out as a guest.</p>
      </div>
      {!sent ? (
        <form onSubmit={request} className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="a-email">E-mail</Label><Input id="a-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy && <Loader2 className="animate-spin" data-icon="inline-start" />}Send me a code</Button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-4">
          <p className="text-sm">We sent a code to <strong>{email}</strong>. It works for 10 minutes.</p>
          <div className="space-y-1.5"><Label htmlFor="a-code">6-digit code</Label><Input id="a-code" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code" className="text-center font-mono text-xl tracking-[0.4em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={busy || code.length !== 6}>{busy && <Loader2 className="animate-spin" data-icon="inline-start" />}Sign in</Button>
          <button type="button" className="w-full text-center text-sm font-semibold text-primary" onClick={() => { setSent(false); setCode(""); setError(null); }}>Use a different e-mail</button>
        </form>
      )}
    </div>
  );
}

function Account({ token, customer }: { token: string; customer: Customer }) {
  const orders = useAsync(() => storeApi<Order[]>("/my-orders", {}, token), `my-orders:${token.slice(-8)}`);
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    try { storeActions.updateCustomer(await storeApi<Customer>("/me", { method: "PUT", body: JSON.stringify({ name: name.trim(), phone: phone.trim() }) }, token)); setMsg("Saved."); }
    catch (err) { setMsg(err instanceof Error ? err.message : "Could not save."); }
  }

  return (
    <div className="grid gap-8 md:grid-cols-[320px_1fr]">
      <form onSubmit={save} className="glass h-fit space-y-4 rounded-xl p-5">
        <h1 className="text-2xl">Your details</h1>
        <p className="text-sm text-muted-foreground">{customer.email}</p>
        <div className="space-y-1.5"><Label htmlFor="p-name">Name</Label><Input id="p-name" required value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="p-phone">Mobile</Label><Input id="p-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        {msg && <p role="status" className="text-sm text-muted-foreground">{msg}</p>}
        <Button type="submit" className="w-full">Save</Button>
        <Button type="button" variant="outline" className="w-full" onClick={() => storeActions.signOut()}><LogOut data-icon="inline-start" />Sign out</Button>
      </form>
      <section>
        <h2 className="mb-4 text-2xl">Your orders</h2>
        {orders.error ? <p className="text-danger">{orders.error.message}</p> : !orders.data ? <p className="text-muted-foreground">Loading…</p> : orders.data.length === 0 ? (
          <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">No orders yet. <Link className="font-semibold text-primary" href="/store">Start shopping</Link></p>
        ) : (
          <ul className="space-y-3" data-testid="my-orders">
            {orders.data.map((o) => (
              <li key={o.number}>
                <Link href={`/store/order/${o.number}`} className="card-lift glass flex flex-wrap items-center justify-between gap-3 rounded-xl p-4">
                  <span><span className="block font-mono font-bold">{o.number}</span><span className="text-xs text-muted-foreground">{o.item_count} item{o.item_count === 1 ? "" : "s"} · collect from {o.branch.name}</span></span>
                  <span className="flex items-center gap-3"><span className="font-semibold tabular-nums">{rupees(o.total)}</span><OrderStatusPill status={o.status} /></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Body() {
  const { token, customer, ready } = useStore();
  if (!ready) return null;
  return token && customer ? <Account token={token} customer={customer} /> : <SignIn />;
}

export default function AccountPage() {
  return <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6"><Suspense fallback={null}><Body /></Suspense></div>;
}
