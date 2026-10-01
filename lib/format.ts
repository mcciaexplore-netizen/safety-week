const inr = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const inr0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export const formatMoney = (n: number) => inr.format(n);
export const formatRupees = (n: number) => `₹${inr.format(n)}`;
export const formatRupeesShort = (n: number) => `₹${inr0.format(Math.round(n))}`;
export const formatNumber = (n: number) => inr0.format(n);

/** d/MMM/yyyy, matching the workbook's `12/Feb/2026` date style. */
export function formatInvoiceDate(iso: string): string {
  const d = new Date(iso);
  const mon = d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  return `${d.getUTCDate()}/${mon}/${d.getUTCFullYear()}`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}
