import type { Metadata } from "next";
import { PrintView } from "./print-view";

export const metadata: Metadata = { title: "Invoice", robots: { index: false } };

/** Rendered by Chromium to make the PDF. Bare page: no navigation, no sign-in, just the invoice sheet. */
export default async function PrintPage(props: PageProps<"/print/invoice/[id]">) {
  const { id } = await props.params;
  const q = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  return <PrintView id={id} version={one(q.v)} token={one(q.t)} />;
}
