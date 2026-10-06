import type { EventConfig, OrganisationProfile } from "@/lib/types";

/**
 * Event + issuer configuration. Kept out of components on purpose (PLAN §7, §26.8):
 * the header text comes from the 2026 workbook (docs/invoice-spec.md §1) but is
 * treated as configuration. Double spaces are intentional: they are in the source.
 */
export const EVENT: EventConfig = {
  id: "evt-nsw-2027",
  name: "National Safety Week",
  year: 2027,
  startDate: null,
  endDate: null,
  status: "PLANNING",
  invoicePrefix: "NSW27",
};

export const ORGANISATION: OrganisationProfile = {
  title: "PROFORMA INVOICE",
  name: "Mahratta Chamber of Commerce, Industries and Agriculture",
  addressLines: [
    "505A & B Wing, 5th floor, MCCIA Trade Tower,  Senapati Bapat Road, Pune 411 016,",
    " Maharashtra  [State Code - 27 ], Tel. 020-27013700 Email : shriramj@mcciapune.com",
  ],
  stateCode: "27",
  phone: "020-27013700",
  email: "shriramj@mcciapune.com",
  gstin: "27AAATM5559Q1ZS",
  pan: "AAATM5559Q",
};

/** Printed as the bold identity line under the address (spec §1, row 5). */
export const ORGANISATION_TAX_LINE = `GSTIN - ${ORGANISATION.gstin}   PAN - ${ORGANISATION.pan}`;

/**
 * Footer stamp + signature images (spec §7). The named signatory is baked into
 * the image; which signatory is valid for 2027 is open question Q6.
 */
export const SIGNATORY = {
  enabled: true,
  logoSrc: "/brand/mccia-logo.png",
  stampSrc: "/brand/mccia-stamp.png", // generic fallback if a branch seal file is missing
  sealDir: "/brand/seals", // SBR.png, TIL.png, BHO.png, HAD.png, AHL.png
  signatureSrc: "/brand/mccia-signature.png",
} as const;

/** Exact label text from the source workbook (docs/invoice-spec.md §2-§7). */
export const LABELS = {
  companyName: "Company Name",
  address: "Address",
  gstin: "GSTIN",
  email: "Email ID",
  contact: "Contact Person & Cell No",
  invoiceNo: "Proforma Invoice No.",
  invoiceDate: "Proforma Invoice Date",
  sr: "Sr.",
  particulars: "Particulars",
  hsn: "HSN Code",
  rate: "Rate",
  qty: "Qty.",
  rateAfterDiscount: "Rate after Discount",
  basic: "Basic Amount",
  cgstRate: "CGST Rate",
  cgstAmt: "CGST AMT",
  sgstRate: "SGST Rate",
  sgstAmt: "SGST AMT",
  total: "Total Amount",
  totalRow: "Total …",
  roundedOff: "Rounded off Amount..",
  amountInWords: "Amount in Words",
  paymentDetails: "Payment Details",
  forOrg: "For MCCIA",
  signatory: "Authorized Signatory",
} as const;

export const APP_NAME = "MCCIA Safety Week Proforma";
