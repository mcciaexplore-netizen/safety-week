import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

// Real API + database (see api.spec.ts). Needs `python -m app.dev_seed`.
test.skip(!process.env.API_E2E, "needs the real API (set API_E2E=1)");
test.setTimeout(120_000);

async function signIn(page: Page, email: string, branch: string) {
  await page.goto(`/login?branch=${branch}`);
  await page.getByLabel("User ID / e-mail").fill(email);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(branch === "ADMIN" ? /\/admin$/ : /dashboard/);
}

const isXlsx = async (path: string) => (await readFile(path)).subarray(0, 2).toString() === "PK"; // .xlsx is a zip file

const API = process.env.API_URL ?? "http://localhost:8000";

test("branch admin: stock -> low-stock card on the dashboard; one-click Excel of the day's invoices", async ({ page, request }) => {
  await signIn(page, "meera@example.invalid", "TIL");
  // one issued invoice today, so there is something to bulk-download
  const tok = (await (await request.post(`${API}/api/v1/dev/token`, { data: { email: "meera@example.invalid" } })).json()).access_token as string;
  const h = { Authorization: `Bearer ${tok}` };
  const prods = (await (await request.get(`${API}/api/v1/products`)).json()) as { id: string; name: string }[];
  const made = await request.post(`${API}/api/v1/invoices`, { headers: h, data: { company_name: "Bulk Download Co", invoice_date: new Date().toISOString().slice(0, 10), action: "submit", items: [{ product_id: prods.find((x) => x.name === "Water Bottle")!.id, quantity: 1 }] } });
  expect(made.status()).toBe(201);

  // stock: opening 5, low at 10 -> Badges shows up as low (or out, if earlier runs already sold more)
  await page.getByTestId("sidebar").getByRole("link", { name: "Stock", exact: true }).click();
  await page.getByLabel("Opening stock for Badges").fill("");   // clear first, so a re-run on the same database still counts as a change
  await page.getByLabel("Opening stock for Badges").fill("5");
  await page.getByLabel("Low level for Badges").fill("10");
  await page.getByRole("button", { name: "Save stock" }).click();
  await expect(page.getByRole("status")).toContainText("Stock saved");
  await expect(page.getByTestId("stock-row").filter({ hasText: "Badges" })).toContainText(/Low|Out/);
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByText("Recent invoices")).toHaveCount(0);
  await expect(page.getByTestId("low-stock-row").filter({ hasText: "Badges" })).toContainText(/Low|Out/);
  await expect(page.getByTestId("low-stock-card")).toContainText("Manage stock");

  // the day's invoices as one Excel workbook
  await page.getByRole("link", { name: "Invoices", exact: true }).click();
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download Excel" }).click()]);
  expect(file.suggestedFilename()).toMatch(/^invoices-TIL-\d{4}-\d{2}-\d{2}\.xlsx$/);
  // a date range works too (Excel) and the PDFs come as a ZIP
  await page.getByRole("button", { name: "Last 30 days" }).click();
  const [range] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download Excel" }).click()]);
  expect(range.suggestedFilename()).toMatch(/^invoices-TIL-\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2}\.xlsx$/);
  const [zip] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download PDFs as a ZIP" }).click()]);
  expect(zip.suggestedFilename()).toMatch(/^invoice-pdfs-TIL-.*\.zip$/);
  expect(await isXlsx((await file.path())!)).toBe(true);
  await expect(page.getByRole("button", { name: /All 5 branches combined/ })).toHaveCount(0); // central admin only

  // an ordinary branch user gets neither the download nor the stock editor
  const user = await (await page.context().browser()!.newContext()).newPage();
  await signIn(user, "rajesh@example.invalid", "TIL");
  await user.goto("/invoices");
  await expect(user.getByTestId("daily-excel")).toHaveCount(0);
  await user.goto("/stock");
  await expect(user.getByLabel("Opening stock for Badges")).toHaveCount(0);
});

test("central admin: combined workbook for all five branches, and each branch separately", async ({ page }) => {
  await page.goto("/login?branch=ADMIN");
  await page.getByLabel("User ID / e-mail").fill("admin@example.invalid");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole("link", { name: "Invoices", exact: true }).click();

  const [all] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download all branches Excel" }).click()]);
  expect(all.suggestedFilename()).toMatch(/^invoices-ALL-\d{4}-\d{2}-\d{2}\.xlsx$/);
  expect(await isXlsx((await all.path())!)).toBe(true);
  for (const [code, name] of [["SBR", "SB Road"], ["TIL", "Tilak Road"], ["BHO", "Bhosari"], ["HAD", "Hadapsar"], ["AHL", "Ahilyanagar"]]) {
    await page.getByRole("group", { name: "Branch" }).getByRole("button", { name, exact: true }).click();
    const [one] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: `Download ${name} Excel` }).click()]);
    expect(one.suggestedFilename()).toMatch(new RegExp(`^invoices-${code}-\\d{4}-\\d{2}-\\d{2}\\.xlsx$`));
  }
  // the central admin can also look at any branch's stock
  await page.getByTestId("sidebar").getByRole("link", { name: "Stock", exact: true }).click();
  await expect(page.getByTestId("stock-matrix-row")).toHaveCount(39);          // all five branches at once
  await page.getByRole("tab", { name: "Set opening stock" }).click();
  await page.getByLabel("Branch").selectOption("BHO");
  await expect(page.getByTestId("stock-row")).toHaveCount(39);
});
