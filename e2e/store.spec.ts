import { expect, test, type APIRequestContext } from "@playwright/test";

// Real API + database (see api.spec.ts). Needs `python -m app.dev_seed`; the API must run with DEV_LOGIN=true.
test.skip(!process.env.API_E2E, "needs the real API (set API_E2E=1)");
test.setTimeout(180_000);

const API = process.env.API_URL ?? "http://localhost:8000";

async function devToken(request: APIRequestContext, email: string) {
  const r = await request.post(`${API}/api/v1/dev/token`, { data: { email } });
  expect(r.ok()).toBeTruthy();
  return { Authorization: `Bearer ${(await r.json()).access_token}` };
}

/** What the central admin does before launch: rates confirmed, event open, and some stock at Tilak Road. */
async function openStoreWithStock(request: APIRequestContext) {
  const h = await devToken(request, "admin@example.invalid");
  await request.post(`${API}/api/v1/admin/products/confirm`, { headers: h, data: {} });
  const events = (await (await request.get(`${API}/api/v1/admin/events`, { headers: h })).json()) as { id: string; name: string; year: number; invoice_prefix: string; status: string; notes: string }[];
  const ev = events.find((e) => e.invoice_prefix === "NSW27")!;
  if (ev.status !== "OPEN") {
    const r = await request.put(`${API}/api/v1/admin/events/${ev.id}`, { headers: h, data: { name: ev.name, year: ev.year, invoice_prefix: ev.invoice_prefix, start_date: "2027-03-04", end_date: "2027-03-10", status: "OPEN", notes: ev.notes } });
    expect(r.ok()).toBeTruthy();
  }
  const products = (await (await request.get(`${API}/api/v1/products`)).json()) as { id: string; name: string }[];
  const mug = products.find((p) => p.name === "Coffee Mugs")!;
  for (const [branch, left] of [["TIL", 10], ["HAD", 0]] as const) {
    const st = (await (await request.get(`${API}/api/v1/stock?branch=${branch}`, { headers: h })).json()) as { items: { name: string; sold: number; transferred_in: number; transferred_out: number }[] };
    const it = st.items.find((i) => i.name === "Coffee Mugs")!;
    const opening = Math.max(0, left + it.sold + it.transferred_out - it.transferred_in);
    await request.put(`${API}/api/v1/stock?branch=${branch}`, { headers: h, data: { items: [{ product_id: mug.id, opening_qty: opening, low_threshold: 2 }] } });
  }
}

test("online store: browse, pick a branch, order for pick-up; the branch hands it over; the central admin sees it", async ({ page, request, browser }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openStoreWithStock(request);

  // browse: price shows the shelf price with the GST-inclusive price in brackets underneath
  await page.goto("/store");
  await expect(page.getByTestId("product-card").first()).toBeVisible();
  // best sellers carry a tag and have their own filter button
  await page.getByRole("button", { name: "Best sellers" }).click();
  await expect(page.getByTestId("best-seller-tag").first()).toBeVisible();
  await expect(page.getByTestId("product-card").filter({ hasText: "Badges" })).toBeVisible();
  await expect(page.getByTestId("product-card").filter({ hasText: "Coffee Mugs" })).toHaveCount(0);
  await page.getByRole("button", { name: "All", exact: true }).click();
  const mug = page.getByTestId("product-card").filter({ hasText: "Coffee Mugs" });
  await expect(mug).toContainText("₹200.00");
  await expect(mug).toContainText("(₹236.00 incl. GST)");
  // shoppers are never shown stock numbers: only "Out of stock" / "Low stock" for the branch they chose
  await page.getByLabel("Pick-up branch").first().selectOption("HAD");
  await expect(mug).toContainText("Out of stock");
  await expect(mug).not.toContainText("Hadapsar");
  await page.getByLabel("Pick-up branch").first().selectOption("TIL");
  await expect(mug).not.toContainText("stock");
  await expect(mug).not.toContainText("10");

  // product page: stock at every branch, add two to the cart
  await mug.getByRole("link").first().click();
  await page.getByRole("button", { name: "Increase Quantity" }).click();
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByTestId("cart-count")).toHaveText("2");

  // cart and checkout: Hadapsar cannot supply it, Tilak Road can
  await page.goto("/store/cart");
  await expect(page.getByTestId("cart-total")).toHaveText("₹472.00"); // 2 x 236
  await page.getByRole("link", { name: "Continue to checkout" }).click();
  // nothing about stock is shown on the branch cards; the check happens when the shopper tries to place the order
  await expect(page.getByTestId("branch-HAD")).not.toContainText("stock");
  await page.getByLabel("Full name").fill("Meera Shopper");
  await page.getByLabel("Mobile number").fill("9822001111");
  await page.getByLabel(/^E-mail/).fill(`meera.${Date.now()}@example.com`);
  await page.getByTestId("branch-HAD").click();
  await page.getByTestId("place-order").click();
  await expect(page.getByTestId("checkout-error")).toContainText("collect it from Tilak Road");   // only a branch that really has it is suggested
  await expect(page.getByTestId("checkout-error")).not.toContainText("Bhosari");
  await page.getByTestId("branch-TIL").click();
  await expect(page.getByText("Pay at pick-up").first()).toBeVisible();
  await expect(page.getByText("Coming soon")).toBeVisible();
  await page.getByTestId("place-order").click();

  // the order page
  await expect(page.getByTestId("order-number")).toContainText("NSW27-TIL-");
  const number = (await page.getByTestId("order-number").innerText()).trim();
  await expect(page.getByTestId("order-total")).toHaveText("₹472.00");
  await expect(page.getByText("Order placed").first()).toBeVisible();
  await expect(page.getByText("you pay at the counter")).toBeVisible();
  const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download invoice" }).click()]);
  expect(pdf.suggestedFilename()).toBe(`${number}.pdf`);
  await page.screenshot({ path: "test-results/20-store-order.png", fullPage: true });

  // the branch (Tilak Road) prepares it and hands it over
  const staff = await (await browser.newContext()).newPage();
  await staff.goto("/login?branch=TIL");
  await staff.getByRole("button", { name: "Sign in" }).click();
  await expect(staff).toHaveURL(/dashboard/);
  await staff.getByRole("link", { name: "Online orders" }).click();
  const row = staff.getByTestId("online-order-row").filter({ hasText: number });
  await expect(row).toContainText("Meera Shopper");
  await expect(row).toContainText("2 × Coffee Mugs");
  await row.getByRole("button", { name: "Mark ready" }).click();
  await expect(row).toContainText("Ready for pick-up");
  await row.getByRole("button", { name: "Collected" }).click();
  await staff.getByLabel("How did the customer pay?").selectOption("RAZORPAY");
  await staff.getByRole("button", { name: "Confirm hand-over" }).click();
  await staff.getByRole("tab", { name: "Collected" }).click();
  await expect(staff.getByTestId("online-order-row").filter({ hasText: number })).toContainText("Paid");

  // the customer's page now shows it collected
  await page.reload();
  await expect(page.getByText("Collected").first()).toBeVisible();

  // the central admin sees online vs offices
  const admin = await (await browser.newContext()).newPage();
  await admin.goto("/login?branch=ADMIN");
  await admin.getByLabel("User ID / e-mail").fill("admin@example.invalid");
  await admin.getByRole("button", { name: "Sign in" }).click();
  await expect(admin).toHaveURL(/\/admin$/);
  await admin.getByRole("link", { name: "Online store" }).click();
  await expect(admin.getByText("Online vs branch offices")).toBeVisible();
  await expect(admin.getByRole("row").filter({ hasText: "Tilak Road" })).toContainText("₹");
  await admin.screenshot({ path: "test-results/21-online-analytics.png", fullPage: true });

  expect(errors).toEqual([]);
});
