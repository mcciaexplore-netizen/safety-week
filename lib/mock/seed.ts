import { EVENT } from "@/lib/config/app-config";
import { computeLine, computeTotals } from "@/lib/invoice/calc";
import { amountInWords } from "@/lib/invoice/words";
import type {
  Invoice,
  InvoiceItem,
  InvoicePayment,
  InvoiceStatus,
  Product,
  SessionUser,
} from "@/lib/types";
import { BRANCHES } from "./branches";
import { PRODUCTS } from "./products";

/** Small deterministic PRNG so demo data is identical on every load. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fictional customers — no real company data is used in the demo. */
const CUSTOMERS = [
  ["Sahyadri Precision Components Pvt. Ltd.", "Plot 14, MIDC Industrial Area", "Rohan Deshmukh", "9800000101"],
  ["Deccan Fasteners & Tools", "Gat No. 212, Chakan", "Meera Kulkarni", "9800000102"],
  ["Nirmal Polymers Pvt. Ltd.", "Sector 7, PCNTDA", "Anil Joshi", "9800000103"],
  ["Bhima Valley Castings", "Koregaon Bhima", "S. Pawar", "9800000104"],
  ["Orchid Electronics (India)", "Kothrud, Pune", "Sonal Nene", "9800000105"],
  ["Vitthal Engineering Works", "Hadapsar Industrial Estate", "Vitthal Gaikwad", "9800000106"],
  ["Trimurti Packaging Solutions", "Ranjangaon MIDC", "Priya Shinde", "9800000107"],
  ["Panchsheel Auto Ancillaries", "Bhosari MIDC", "Kiran Patil", "9800000108"],
  ["Godavari Agro Machines", "MIDC Ahilyanagar", "Rahul Thorat", "9800000109"],
  ["Shivneri Rubber Industries", "Talegaon Dabhade", "N. More", "9800000110"],
  ["Kalyani Forge & Alloys", "Mundhwa, Pune", "Deepak Kale", "9800000111"],
  ["Mahalaxmi Textiles Pvt. Ltd.", "Supa MIDC", "Ashwini Bhosale", "9800000112"],
  ["Indrayani Logistics", "Moshi, Pune", "Sagar Jadhav", "9800000113"],
  ["Ashtavinayak Plastics", "Urali Kanchan", "R. Mane", "9800000114"],
  ["Lokmanya Chemicals Pvt. Ltd.", "Ranjangaon MIDC", "Tejas Wagh", "9800000115"],
  ["Pratibha Instruments", "Tilak Road, Pune", "Pratibha Ranade", "9800000116"],
  ["Sinhagad Cables Ltd.", "Narhe, Pune", "Amit Sathe", "9800000117"],
  ["Kasturi Foods Processing", "Loni Kalbhor", "Kasturi Bhat", "9800000118"],
  ["Malhar Steel Fabricators", "Ahilyanagar MIDC", "Malhar Dange", "9800000119"],
  ["Rajgad Industrial Supplies", "Wagholi, Pune", "V. Chavan", "9800000120"],
];

const STATUS_POOL: InvoiceStatus[] = [
  "SUBMITTED", "SUBMITTED", "GENERATED", "GENERATED", "GENERATED",
  "DRAFT", "EDITED", "SUBMITTED", "CANCELLED",
];

const COUNTS: Record<string, number> = {
  "br-sbr": 9, "br-til": 7, "br-bho": 6, "br-had": 6, "br-ahl": 5,
};

const USERS = [
  "Anjali Kulkarni", "Rajesh Patil", "Sneha Bapat", "Mahesh Gokhale", "Pooja Deshpande",
];

export const DEMO_USERS: Record<string, SessionUser> = Object.fromEntries(
  BRANCHES.map((b, i) => [
    b.id,
    {
      id: `usr-${b.code.toLowerCase()}`,
      name: USERS[i],
      email: `${USERS[i].split(" ")[0].toLowerCase()}@example.invalid`,
      role: "BRANCH_USER" as const,
      branchId: b.id,
    },
  ]),
);

export function buildItem(
  product: Product,
  quantity: number,
  discountPercent: number,
  lineOrder: number,
): InvoiceItem {
  const line = computeLine({
    rate: product.currentRate,
    quantity,
    discountPercent,
    cgstRate: product.gstHalfRate,
    sgstRate: product.gstHalfRate,
  });
  return {
    id: `itm-${product.id}-${lineOrder}`,
    productId: product.id,
    particulars: product.name,
    hsnCode: product.hsnCode,
    rate: product.currentRate,
    quantity,
    discountPercent,
    rateAfterDiscount: line.rateAfterDiscount,
    basicAmount: line.basicAmount,
    cgstRate: product.gstHalfRate,
    cgstAmount: line.cgstAmount,
    sgstRate: product.gstHalfRate,
    sgstAmount: line.sgstAmount,
    totalAmount: line.totalAmount,
    lineOrder,
  };
}

export function seedInvoices(): Invoice[] {
  const out: Invoice[] = [];
  BRANCHES.forEach((branch, bi) => {
    const rand = mulberry32(2027 + bi * 101);
    const count = COUNTS[branch.id];
    for (let n = 1; n <= count; n++) {
      const cust = CUSTOMERS[(bi * 4 + n * 3) % CUSTOMERS.length];
      const discount = rand() < 0.3 ? (rand() < 0.5 ? 5 : 10) : 0;
      const lineCount = 2 + Math.floor(rand() * 5);
      const picked = new Set<number>();
      while (picked.size < lineCount) picked.add(Math.floor(rand() * PRODUCTS.length));
      const items = [...picked]
        .sort((a, b) => a - b)
        .map((pi, idx) =>
          buildItem(PRODUCTS[pi], 1 + Math.floor(rand() * rand() * 60), discount, idx + 1),
        );
      const totals = computeTotals(items);
      const status = STATUS_POOL[Math.floor(rand() * STATUS_POOL.length)];
      const day = 4 + Math.floor((n / count) * 50);
      const date = new Date(Date.UTC(2027, 0, day, 6 + (n % 8), (n * 17) % 60));
      const seq = String(n).padStart(6, "0");
      // demo variety: mostly one UPI payment, every 3rd invoice is split UPI + cash, every 5th only part-paid
      const total = totals.roundedTotal;
      const utr = `UTR ${600000000000 + bi * 1000003 + n * 7919}`;
      const half = Math.floor(total / 2);
      const payments: InvoicePayment[] =
        status === "DRAFT" || total < 2
          ? []
          : n % 3 === 0
            ? [{ mode: "UPI", amount: half, reference: utr }, { mode: "CASH", amount: total - half, reference: "" }]
            : n % 5 === 0
              ? [{ mode: "CASH", amount: half, reference: "" }]
              : [{ mode: "UPI", amount: total, reference: utr }];
      out.push({
        id: `inv-${branch.code.toLowerCase()}-${seq}`,
        invoiceNumber: `${EVENT.invoicePrefix}-${branch.code}-${seq}`,
        eventId: EVENT.id,
        branchId: branch.id,
        status,
        invoiceDate: date.toISOString(),
        customer: {
          companyName: cust[0],
          address: cust[1],
          gstin: `27AAAC${(100 + bi * 7 + n).toString().padStart(4, "0")}A1Z${n % 9}`,
          email: `accounts${n}@example.invalid`,
          contactPerson: cust[2],
          contactPhone: cust[3],
        },
        items,
        totals,
        amountInWords: amountInWords(totals.roundedTotal),
        paymentDetails: "",
        payments,
        version: status === "EDITED" ? 2 : 1,
        createdBy: USERS[bi],
        createdAt: date.toISOString(),
        updatedAt: new Date(date.getTime() + 3_600_000 * (n % 30)).toISOString(),
      });
    }
  });
  return out;
}
