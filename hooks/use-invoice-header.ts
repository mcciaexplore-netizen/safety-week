"use client";

import { useEffect, useState } from "react";
import { LABELS, ORGANISATION } from "@/lib/config/app-config";
import { API_URL, api } from "@/lib/services/api";

/** The text printed at the top and bottom of every invoice. Admin-editable in API mode. */
export interface HeaderConfig {
  title: string;
  name: string;
  addressLines: string[];
  gstin: string;
  pan: string;
  forOrg: string;
  signatory: string;
}

export const DEFAULT_HEADER: HeaderConfig = {
  title: ORGANISATION.title,
  name: ORGANISATION.name,
  addressLines: ORGANISATION.addressLines,
  gstin: ORGANISATION.gstin,
  pan: ORGANISATION.pan,
  forOrg: LABELS.forOrg,
  signatory: LABELS.signatory,
};

let cache: Promise<HeaderConfig> | null = null;

/** Forget the cached header (call after an admin saves a change). */
export const resetInvoiceHeader = () => {
  cache = null;
};

function load(): Promise<HeaderConfig> {
  cache ??= api<{ title: string; name: string; address_lines: string[]; gstin: string; pan: string; for_org: string; signatory: string }>(
    "/settings/invoice",
  ).then((h) => ({ title: h.title, name: h.name, addressLines: h.address_lines, gstin: h.gstin, pan: h.pan, forOrg: h.for_org, signatory: h.signatory }));
  return cache;
}

/** `loaded` matters for the PDF renderer: it must not print before the real header has arrived. */
export function useInvoiceHeader(): { header: HeaderConfig; loaded: boolean } {
  const [state, setState] = useState<{ header: HeaderConfig; loaded: boolean }>({ header: DEFAULT_HEADER, loaded: !API_URL });
  useEffect(() => {
    if (!API_URL) return;
    let live = true;
    load().then(
      (header) => live && setState({ header, loaded: true }),
      () => {
        cache = null; // keep the built-in defaults, try again next time
        if (live) setState({ header: DEFAULT_HEADER, loaded: true });
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}
