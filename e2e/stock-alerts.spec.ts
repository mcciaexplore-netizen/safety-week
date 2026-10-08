import { expect, test, type APIRequestContext } from "@playwright/test";

// Real API + database (see api.spec.ts).
test.skip(!process.env.API_E2E, "needs the real API (set API_E2E=1)");
test.setTimeout(120_000);

const API = process.env.API_URL ?? "http://localhost:8000";

async function token(request: APIRequestContext, email: string) {
  const r = await request.post(`${API}/api/v1/dev/token`, { data: { email } });
  return { Authorization: `Bearer ${(await r.json()).access_token}` };
}

test("proforma: a quantity above the stock turns red and cannot be submitted; admins see a low-stock button", async ({ page, request, browser }) => {
  const admin = await token(request, "admin@example.invalid");
  const products = (await (await request.get(`${API}/api/v1/products`)).json()) as { id: string; name: string }[];
  const caps = products.find((p) => p.name === "Caps")!;
  const st = (await (await request.get(`${API}/api/v1/stock?branch=BHO`, { headers: admin })).json()) as { items: { name: string; sold: number; transferred_in: number; transferred_out: number }[] };
  const it = st.items.find((i) => i.name === "Caps")!;
  const base = it.sold + it.transferred_out - it.transferred_in;
  // Sneha Bapat's branch (Bhosari) has 4 caps left, low at 5
  await request.put(`${API}/api/v1/stock?branch=BHO`, { headers: admin, data: { items: [{ product_id: caps.id, opening_qty: base + 4, low_threshold: 5 }] } });

  await page.goto("/login?branch=BHO");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/invoices/new");
  await page.getByLabel("Company Name", { exact: true }).fill("Stock Test Co");
  const row = page.getByTestId("material-row").filter({ hasText: "Caps" });
  await expect(row.getByTestId("stock-left")).toHaveText("4");
  await page.getByLabel("Quantity for Caps", { exact: true }).fill("5");
  await expect(row).toContainText("Only 4 in stock");
  await expect(page.getByLabel("Quantity for Caps", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("button", { name: "Submit", exact: true })).toBeDisabled();
  await page.screenshot({ path: "test-results/22-over-stock.png" });
  await page.getByLabel("Quantity for Caps", { exact: true }).fill("4");
  await expect(row).not.toContainText("Only 4 in stock");
  await expect(page.getByRole("button", { name: "Submit", exact: true })).toBeEnabled();

  // the central admin sees the low-stock button on every screen and on the product itself
  const a = await (await browser.newContext()).newPage();
  await a.goto("/login?branch=ADMIN");
  await a.getByLabel("User ID / e-mail").fill("admin@example.invalid");
  await a.getByRole("button", { name: "Sign in" }).click();
  await expect(a).toHaveURL(/\/admin$/);
  await a.getByTestId("low-stock-alert").getByRole("button").click();
  await expect(a.getByRole("menu")).toContainText("Caps");
  await a.getByRole("link", { name: /Open the Stock page/ }).click();
  await expect(a).toHaveURL(/\/stock/);
  await a.getByRole("link", { name: "Products" }).click();
  await expect(a.getByTestId("product-stock-flag").first()).toBeVisible();
  await a.screenshot({ path: "test-results/23-low-stock-flags.png" });
});
