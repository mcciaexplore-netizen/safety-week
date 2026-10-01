import type { Product } from "@/lib/types";

/**
 * Product/material master — 39 rows in workbook order (docs/invoice-spec.md §4.3).
 * Rates are the 2026 workbook values used as a starting catalogue only; they are
 * configuration, not 2027 truth (PLAN §9, §26.8).
 */
const RATE_SOURCE = "2026-workbook-reference";

type Row = [line: number, sr: number | null, name: string, hsn: string, rate: number, gstHalf: number];

const ROWS: Row[] = [
  [1, 1, "Badges", "49090090", 4.8, 9.0],
  [2, 2, "Ball Pens", "96081019", 20.0, 9.0],
  [3, null, "Ball Pens (Matt Finish)", "96081019", 35.0, 9.0],
  [4, 3, "Banners - Cloth - English - 6 x 3", "59119090", 390.0, 2.5],
  [5, 4, "Banners - Cloth - Hindi - 6 x 3", "59119090", 390.0, 2.5],
  [6, 5, "Banners - Cloth - Marathi - 6 x 3", "59119090", 390.0, 2.5],
  [7, 6, "Banners - Flex - English -  6x3", "39209999", 450.0, 9.0],
  [8, 7, "Banners - Flex - Hindi -  6x3", "39209999", 450.0, 9.0],
  [9, 8, "Banners - Flex - Marathi -  6x3", "39209999", 450.0, 9.0],
  [10, 9, "Banners - PPE Flex - 5x2", "39209999", 430.0, 9.0],
  [11, 10, "Caps", "61091000", 100.0, 2.5],
  [12, 11, "Coffee Mugs", "69120010", 200.0, 9.0],
  [13, 12, "Danglers - Set of 20", "49119920", 170.0, 9.0],
  [14, 13, "Flags - Normal", "61091000", 375.0, 2.5],
  [15, 14, "Flags - Handy", "61091000", 75.0, 2.5],
  [16, 15, "Oath English  Flex", "39209999", 270.0, 9.0],
  [17, 16, "Oath Hindi  Flex", "39209999", 270.0, 9.0],
  [18, 17, "Oath Marathi  Flex", "39209999", 270.0, 9.0],
  [19, 18, "Pocket Books - Mr. Bulakh", "49090090", 65.0, 9.0],
  [20, 19, "Pocket Guide (Set of 25 Nos.)", "49090090", 375.0, 9.0],
  [21, 20, "Pocket Calendars - Set of 40", "49100090", 340.0, 9.0],
  [22, 21, "Posters Safety", "49119920", 130.0, 9.0],
  [23, 22, "Posters 5-S", "49119920", 130.0, 9.0],
  [24, 23, "Scrolls - Do's & Don’ts - English Set of 2", "39209999", 670.0, 9.0],
  [25, 24, "Scrolls - Do's & Don’ts - Marathi Set of 2", "39209999", 670.0, 9.0],
  [26, 25, "PPE Scrolls Safety - English", "39209999", 370.0, 9.0],
  [27, 26, "PPE Scrolls Safety - Marathi", "39209999", 370.0, 9.0],
  [28, 27, "Scrolls Security - Marathi", "39209999", 370.0, 9.0],
  [29, 28, "Slogans - 7.5 x 20", "49119920", 70.0, 9.0],
  [30, 29, "Slogans - 10 x 15", "49119920", 80.0, 9.0],
  [31, 30, "Slogans - 15 x 20", "49119920", 90.0, 9.0],
  [32, 31, "Stickers for Vehicles - Set of 30", "49119920", 150.0, 9.0],
  [33, 32, "T-Shirts - L", "61091000", 340.0, 2.5],
  [34, 33, "T Shirts - XL", "61091000", 340.0, 2.5],
  [35, 34, "T Shirts - XXL", "61091000", 340.0, 2.5],
  [36, null, "T-Shirts - L (Premium Quality)", "61091000", 450.0, 2.5],
  [37, null, "T Shirts - XL (Premium Quality)", "61091000", 450.0, 2.5],
  [38, null, "T Shirts - XXL (Premium Quality)", "61091000", 450.0, 2.5],
  [39, 35, "Water Bottle", "96170090", 400.0, 9.0],
];

export const PRODUCTS: Product[] = ROWS.map(([line, sr, name, hsn, rate, gstHalf]) => ({
  id: `prd-${String(line).padStart(2, "0")}`,
  sku: `NSW-${String(line).padStart(3, "0")}`,
  name,
  hsnCode: hsn,
  unit: "Nos.",
  currentRate: rate,
  gstHalfRate: gstHalf,
  srNo: sr,
  lineOrder: line,
  active: true,
}));

export { RATE_SOURCE };
