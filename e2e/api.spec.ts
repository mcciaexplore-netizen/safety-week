import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

// Runs the browser against the REAL API + PostgreSQL. Start the API (DEV_LOGIN=true) and
// `NEXT_PUBLIC_API_URL=http://localhost:8000 next dev -p 3200`, then:  API_E2E=1 BASE_URL=http://localhost:3200 npx playwright test api
test.skip(!process.env.API_E2E, "needs the real API (set API_E2E=1)");
test.setTimeout(150_000); // one long journey: draft -> submit -> revise -> admin review -> cancel

const company = (page: Page) => page.getByLabel("Company Name", { exact: true });

async function signIn(page: Page, code: string) {
  await page.goto(`/login?branch=${code}`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);
}

test("real backend: draft -> reopen -> submit -> revise; branch scoping; wrong-branch login refused", async ({ page, browser }) => {
  const name = `E2E Real Co ${Date.now()}`;
  await signIn(page, "TIL");
  await expect(page.getByText("Development build")).toBeVisible();

  // create a draft; the server (not the browser) assigns the number
  await page.goto("/invoices/new");
  await expect(page.getByTestId("paper-invoice-no")).toHaveText(/^NSW27-TIL-\d{6}$/);
  await company(page).fill(name);
  await page.getByLabel("Proforma Invoice Date").fill("2027-02-12");
  const matt = page.getByLabel("Quantity for Ball Pens (Matt Finish)", { exact: true });
  await expect(page.getByTestId("qty-input")).toHaveCount(39); // the whole catalogue is on the sheet
  await matt.fill("3");
  await expect(page.getByTestId("paper-grand-total")).toHaveText("123.90");
  await expect(page.getByLabel(/^Rate for /)).toHaveCount(0); // branch users cannot change rates (no rate inputs)
  await page.getByLabel("Mode of payment").selectOption("UPI");        // full amount, taken automatically
  await page.getByLabel("Payment reference").fill("UTR 604794369987");
  await page.getByRole("button", { name: /Save Draft/ }).click();
  await expect(page.getByTestId("save-state")).toContainText("Draft saved");
  await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}\/edit/); // UUID primary key in the URL
  const number = (await page.getByTestId("paper-invoice-no").innerText()).trim();
  expect(number).toMatch(/^NSW27-TIL-\d{6}$/);

  // reopen from a fresh page load: everything comes back from the database
  await page.reload();
  await expect(company(page)).toHaveValue(name);
  await expect(matt).toHaveValue("3");
  await expect(page.getByLabel("Mode of payment")).toHaveValue("UPI");   // the payment came back from the database
  await expect(page.getByTestId("paper-payment")).toContainText("UPI Rs. 124.00 (UTR 604794369987)");
  await expect(page.getByTestId("paper-grand-total")).toHaveText("123.90");

  // history: search by id fragment and by company, status filter
  await page.goto("/invoices");
  await page.getByLabel("Search invoices").fill(number.slice(-6));
  await expect(page.getByRole("link", { name: number, exact: true })).toBeVisible();
  await page.getByLabel("Search invoices").fill(name.toLowerCase());
  await expect(page.getByRole("link", { name: number, exact: true })).toBeVisible();
  await page.getByLabel("Filter by status").selectOption("SUBMITTED");
  await expect(page.getByText("No invoices match your search")).toBeVisible();
  await page.getByLabel("Filter by status").selectOption("DRAFT");
  await expect(page.getByRole("link", { name: number, exact: true })).toBeVisible();

  // submit -> success; the server recalculated (total unchanged) and status is Submitted
  await page.getByRole("link", { name: `Edit ${number}` }).click();
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByText("Invoice submitted")).toBeVisible();
  // the success dialog offers the PDF: a real, stored PDF comes back
  const [pdf] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Download PDF/ }).click(),
  ]);
  expect(pdf.suggestedFilename()).toBe(`${number}.pdf`);
  expect((await readFile((await pdf.path())!)).subarray(0, 5).toString()).toBe("%PDF-");
  await page.getByRole("link", { name: "View invoice" }).click();
  await expect(page.getByText(/^(Submitted|PDF generated)$/).first()).toBeVisible();
  await expect(page.getByTestId("paper-grand-total")).toHaveText("123.90");

  // revise -> Edited, version 2
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await matt.fill("10");
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(page.getByTestId("error-editReason")).toHaveText("Give a reason for the change"); // no reason, no revision
  await page.getByLabel("Reason for this change").fill("customer raised the quantity");
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(page.getByText("Revision saved")).toBeVisible();
  await page.goto("/invoices");
  await page.getByLabel("Search invoices").fill(number);
  const row = page.getByRole("row").filter({ hasText: number });
  await expect(row.getByText("Edited", { exact: true })).toBeVisible();
  await expect(row.getByText("₹413.00")).toBeVisible();

  // dashboard is built from real data
  // history: Download works from the row too (this is version 2's PDF, created on demand or in the background)
  const [rowPdf] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: `Download PDF for ${number}` }).click(),
  ]);
  expect((await readFile((await rowPdf.path())!)).subarray(0, 5).toString()).toBe("%PDF-");

  await page.goto("/dashboard");
  await expect(page.getByText("Invoices (active)")).toBeVisible();

  // another branch cannot see it
  const other = await (await browser.newContext()).newPage();
  await signIn(other, "SBR");
  await other.goto("/invoices");
  await other.getByLabel("Search invoices").fill(name);
  await expect(other.getByText("No invoices match your search")).toBeVisible();

  // picking the wrong branch at login is refused by the server-side profile
  const third = await (await browser.newContext()).newPage();
  await third.goto("/login?branch=HAD");
  await third.getByLabel("User ID / e-mail").fill("rajesh@example.invalid"); // a Tilak account
  await third.getByRole("button", { name: "Sign in" }).click();
  await expect(third.getByText(/belongs to Tilak Road, not Hadapsar/)).toBeVisible();

  // ---- admin view (Tilak branch admin) ----
  const admin = await (await browser.newContext()).newPage();
  await admin.goto("/login?branch=TIL");
  await admin.getByLabel("User ID / e-mail").fill("meera@example.invalid");
  await admin.getByRole("button", { name: "Sign in" }).click();
  await expect(admin).toHaveURL(/dashboard/);
  await admin.goto("/invoices");
  await admin.getByLabel("Search invoices").fill(number);
  await admin.getByRole("link", { name: number, exact: true }).click();

  const rows = admin.getByTestId("version-row");
  await expect(rows).toHaveCount(2); // v2 (revision) above v1 (original)
  await expect(rows.nth(0)).toContainText("v2");
  await expect(rows.nth(0)).toContainText("customer raised the quantity");
  await expect(rows.nth(0)).toContainText("Rajesh Patil");
  await expect(rows.nth(1)).toContainText("v1");
  await admin.getByRole("button", { name: "View version 1" }).click(); // the old version, exactly as it was
  await expect(admin.getByText("Version 1 — as it was then")).toBeVisible();
  await expect(admin.getByRole("dialog").getByTestId("paper-grand-total")).toHaveText("123.90");
  await admin.keyboard.press("Escape");
  await expect(admin.getByTestId("paper-grand-total").first()).toHaveText("413.00"); // current = version 2

  // an ordinary branch user has no admin panel and no audit log
  await page.goto(page.url().replace(/\/edit$/, ""));
  await expect(page.getByTestId("version-row")).toHaveCount(0);
  await page.goto("/admin/audit-logs");
  await expect(page.getByText("Admins only")).toBeVisible();

  // cancel with a reason: the invoice stays but is read-only
  await admin.getByRole("button", { name: "Cancel invoice" }).first().click();
  await admin.getByLabel("Reason for cancellation").fill("customer withdrew the order");
  await admin.getByRole("dialog").getByRole("button", { name: "Cancel invoice" }).click();
  await expect(admin.getByTestId("version-row").first()).toContainText("v3");
  await expect(admin.getByTestId("version-row").first()).toContainText("customer withdrew the order");
  await expect(admin.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);

  // audit log shows the whole story, newest first
  await admin.goto("/admin/audit-logs");
  await expect(admin.getByTestId("audit-row").first()).toContainText("invoice.cancel");
  const text = await admin.getByTestId("audit-row").allInnerTexts();
  const mine = text.filter((t) => t.includes(number)).map((t) => t.split("	")[1]);
  expect(mine).toEqual(expect.arrayContaining(["invoice.create", "invoice.submit", "invoice.revise", "invoice.cancel", "invoice.pdf", "invoice.download"]));
  await expect(admin.getByTestId("audit-row").filter({ hasText: "auth.login" }).first()).toBeVisible();
});
