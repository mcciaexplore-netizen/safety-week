import type { Branch } from "@/lib/types";

/** The five operational branches — LOCKED (PLAN §2). Do not add or rename. */
export const BRANCHES: Branch[] = [
  {
    id: "br-sbr",
    code: "SBR",
    name: "SB Road",
    address: "MCCIA Trade Tower, Senapati Bapat Road, Pune",
    phone: "020-27013700",
    email: "sbroad@example.invalid",
    active: true,
  },
  {
    id: "br-til",
    code: "TIL",
    name: "Tilak Road",
    address: "Tilak Road, Pune",
    phone: "—",
    email: "tilakroad@example.invalid",
    active: true,
  },
  {
    id: "br-bho",
    code: "BHO",
    name: "Bhosari",
    address: "Bhosari, Pune",
    phone: "—",
    email: "bhosari@example.invalid",
    active: true,
  },
  {
    id: "br-had",
    code: "HAD",
    name: "Hadapsar",
    address: "Hadapsar, Pune",
    phone: "—",
    email: "hadapsar@example.invalid",
    active: true,
  },
  {
    id: "br-ahl",
    code: "AHL",
    name: "Ahilyanagar",
    address: "Ahilyanagar, Maharashtra",
    phone: "—",
    email: "ahilyanagar@example.invalid",
    active: true,
  },
];
