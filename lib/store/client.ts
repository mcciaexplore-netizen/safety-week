"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { API_URL } from "@/lib/services/api";

/* ---------- types (what the store API returns) ---------- */
export interface Branch { code: string; name: string; address: string; phone: string }
export interface Product {
  id: string; slug: string; name: string; category: string; image_url: string; best_seller: boolean; unit: string; hsn_code: string;
  rate: string; gst_percent: string; price_incl_gst: string; stock_status: Record<string, "OK" | "LOW" | "OUT">;
}
export interface Catalogue {
  open: boolean; event?: string; year?: number; branches: Branch[]; categories: string[]; products: Product[];
  pickup_hold_days?: number; online_payments?: boolean;
}
export interface Customer { id: string; email: string; name: string; phone: string }
export type OrderStatus = "PLACED" | "READY" | "PICKED_UP" | "CANCELLED" | "EXPIRED";
export interface Order {
  number: string; status: OrderStatus; payment_method: "PAY_AT_PICKUP" | "ONLINE"; payment_status: "UNPAID" | "PAID";
  branch: Branch; total: string; item_count: number; note: string; created_at: string; ready_at: string | null;
  picked_up_at: string | null; hold_until: string; access_token?: string;
  customer: { name: string; email: string; phone: string };
  items: { name: string; quantity: number; rate: string; amount: string }[];
}

/* ---------- money ---------- */
export const rupees = (n: number | string) =>
  `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const gstPrice = (p: Product) => Number(p.price_incl_gst);

/* ---------- API ---------- */
export class StoreError extends Error {
  constructor(message: string, public status: number, public short?: { product_id: string; name: string; message: string; alternatives: string[] }[]) {
    super(message);
  }
}

export async function storeApi<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1/store${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.ok) return (await res.json()) as T;
  const detail = ((await res.json().catch(() => null)) as { detail?: unknown } | null)?.detail;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const d = detail as { message?: string; short?: StoreError["short"] };
    throw new StoreError(d.message ?? "Something went wrong", res.status, d.short);
  }
  const msg =
    typeof detail === "string" ? detail
    : Array.isArray(detail) ? detail.map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).slice(1).join(".")}: ${d.msg}`).join("; ")
    : "Something went wrong. Please try again.";
  throw new StoreError(msg, res.status);
}

/** Downloads a PDF the store API returns (an order's invoice). */
export async function downloadOrderInvoice(number: string, auth: { token?: string | null; t?: string | null; email?: string | null }) {
  const q = new URLSearchParams();
  if (auth.t) q.set("t", auth.t);
  else if (!auth.token && auth.email) q.set("email", auth.email);
  const res = await fetch(`${API_URL}/api/v1/store/orders/${number}/invoice?${q}`, {
    headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : {},
  });
  if (!res.ok) throw new StoreError("The invoice is not available right now. Please try again shortly.", res.status);
  const url = URL.createObjectURL(await res.blob());
  Object.assign(document.createElement("a"), { href: url, download: `${number}.pdf` }).click();
  URL.revokeObjectURL(url);
}

/* ---------- catalogue (fetched once, shared by every page) ---------- */
let cached: { at: number; data: Promise<Catalogue> } | null = null;
export function loadCatalogue(force = false): Promise<Catalogue> {
  if (!force && cached && Date.now() - cached.at < 30_000) return cached.data;
  const data = storeApi<Catalogue>("/catalogue");
  cached = { at: Date.now(), data };
  data.catch(() => { cached = null; });
  return data;
}

export function useCatalogue(): { data: Catalogue | null; error: string | null; reload: () => void } {
  const [state, setState] = useState<{ data: Catalogue | null; error: string | null }>({ data: null, error: null });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    loadCatalogue(n > 0).then(
      (data) => live && setState({ data, error: null }),
      (e: unknown) => live && setState({ data: null, error: e instanceof Error ? e.message : "Could not load the store." }),
    );
    return () => { live = false; };
  }, [n]);
  return { ...state, reload: () => setN((x) => x + 1) };
}

/* ---------- cart, pick-up branch and sign-in: one small persisted store ---------- */
interface StoreState { cart: Record<string, number>; branch: string | null; token: string | null; customer: Customer | null }
const KEY = "mccia.store.v1";
const EMPTY: StoreState = { cart: {}, branch: null, token: null, customer: null };
let state: StoreState = EMPTY;
let hydrated = false;
const listeners = new Set<() => void>();

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) state = { ...EMPTY, ...(JSON.parse(raw) as Partial<StoreState>) };
  } catch { /* private mode / bad data: start empty */ }
}
function set(next: Partial<StoreState>) {
  state = { ...state, ...next };
  try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}
function subscribe(cb: () => void) {
  hydrate();
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { hydrated = false; hydrate(); cb(); } };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(cb); window.removeEventListener("storage", onStorage); };
}

export const storeActions = {
  setQty(id: string, qty: number) {
    const cart = { ...state.cart };
    if (qty <= 0) delete cart[id]; else cart[id] = Math.floor(qty); // no limit: stock is checked at checkout
    set({ cart });
  },
  add(id: string, qty = 1) { storeActions.setQty(id, (state.cart[id] ?? 0) + qty); },
  clear() { set({ cart: {} }); },
  setBranch(code: string | null) { set({ branch: code }); },
  signIn(token: string, customer: Customer) { set({ token, customer }); },
  updateCustomer(customer: Customer) { set({ customer }); },
  signOut() { set({ token: null, customer: null }); },
};

export function useStore(): StoreState & { ready: boolean } {
  const snap = useSyncExternalStore(subscribe, () => { hydrate(); return state; }, () => EMPTY);
  const ready = useSyncExternalStore(() => () => {}, () => true, () => false);
  return { ...snap, ready };
}

/* ---------- helpers shared by cart / checkout ---------- */
export function cartLines(cat: Catalogue | null, cart: Record<string, number>) {
  if (!cat) return [];
  return Object.entries(cart)
    .map(([id, qty]) => ({ product: cat.products.find((p) => p.id === id), qty }))
    .filter((l): l is { product: Product; qty: number } => !!l.product);
}
export function cartTotals(lines: { product: Product; qty: number }[]) {
  const basic = lines.reduce((a, l) => a + Number(l.product.rate) * l.qty, 0);
  const gross = lines.reduce((a, l) => a + Number(l.product.rate) * l.qty * (1 + Number(l.product.gst_percent) / 100), 0);
  return { basic, gst: gross - basic, total: Math.round(gross), count: lines.reduce((a, l) => a + l.qty, 0) };
}
