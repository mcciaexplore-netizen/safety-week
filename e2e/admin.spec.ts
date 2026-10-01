import { expect, test, type Page } from "@playwright/test";

// Real API + database (see api.spec.ts for how to start it). Needs `python -m app.dev_seed`.
test.skip(!process.env.API_E2E, "needs the real API (set API_E2E=1)");
test.setTimeout(180_000);

async function signInCentral(page: Page) {
  await page.goto("/select-branch");
  await page.getByRole("link", { name: "Central admin sign-in" }).click();
  await page.getByLabel("User ID / e-mail").fill("admin@example.invalid");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test("central admin: overview, branches, users, products, event, header, discounts, packages, reports", async ({ page, browser }) => {
  await signInCentral(page);
  await expect(page.getByRole("heading", { name: "Admin overview" })).toBeVisible();
  await expect(page.getByRole("region", { name: "By branch" }).or(page.getByText("By branch"))).toBeVisible();

  // --- branches: exactly the five, details editable, names locked ---
  await page.getByRole("link", { name: "Branches" }).click();
  const rows = page.getByTestId("branch-row");
  await expect(rows).toHaveCount(5);
  for (const n of ["SB Road", "Tilak Road", "Bhosari", "Hadapsar", "Ahilyanagar"]) await expect(page.getByRole("cell", { name: n, exact: true })).toBeVisible();
  const phone = `020-${Date.now().toString().slice(-7)}`;
  await page.getByRole("button", { name: "Edit Hadapsar" }).click();
  await page.getByLabel("Phone").fill(phone);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("row", { name: /Hadapsar/ })).toContainText(phone);

  // --- users: add one, change role, guard against self-demotion ---
  await page.getByRole("link", { name: "Users" }).click();
  const stamp = Date.now();
  const email = `qa.${stamp}@example.com`;
  const qaName = `QA ${stamp}`;
  await page.getByRole("button", { name: "Add user" }).click();
  await page.getByLabel("E-mail (login)").fill(email);
  await page.getByLabel("Name", { exact: true }).fill(qaName);
  await page.getByLabel("Branch").selectOption("AHL");
  await page.getByRole("button", { name: "Save" }).click();
  const qa = page.getByRole("row", { name: new RegExp(qaName) });
  await expect(qa).toContainText("AHL");
  await page.getByRole("button", { name: `Edit ${qaName}` }).click();
  await page.getByLabel("Role").selectOption("BRANCH_ADMIN");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(qa).toContainText("Branch admin");
  await page.getByRole("button", { name: "Edit Central Admin" }).click();
  await page.getByLabel("Account is active").uncheck();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toContainText("cannot demote or deactivate your own account");
  await page.getByRole("button", { name: "Cancel" }).click();

  // --- products: 2026 values are flagged until confirmed; editing a rate confirms it ---
  await page.getByRole("link", { name: "Products" }).click();
  await expect(page.getByTestId("product-row")).toHaveCount(39, { timeout: 15000 });
  const badges = page.getByTestId("product-row").filter({ hasText: /^\s*1\s*Badges/ });
  const stale = (await page.getByText("2026 reference").count()) > 0;
  if (stale) await expect(page.getByRole("status")).toContainText("2026 reference values");
  await page.getByRole("button", { name: "Edit Badges" }).click();
  await page.getByLabel("Rate (₹)").fill("5.10");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(badges).toContainText("5.10");
  await expect(badges).toContainText("Confirmed");
  await page.getByRole("button", { name: "Edit Badges" }).click();   // put the workbook rate back for the other tests
  await page.getByLabel("Rate (₹)").fill("4.80");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(badges).toContainText("4.80");

  // --- event: dates, and the rule that stops unconfirmed rates going live ---
  await page.getByRole("link", { name: "Event configuration" }).click();
  await page.getByRole("button", { name: "Edit event" }).click();
  await page.getByLabel("Start date").fill("2027-03-04");
  await page.getByLabel("End date").fill("2027-03-11");
  await page.getByLabel("Status").selectOption("OPEN");
  await page.getByRole("button", { name: "Save" }).click();
  const dialog = page.getByRole("dialog");
  const refusal = dialog.getByRole("alert");
  await Promise.race([refusal.waitFor(), dialog.waitFor({ state: "hidden" })]);   // server refuses, or accepts and the dialog closes
  if (await dialog.count()) {
    await expect(refusal).toContainText("2026 reference values");   // 2026 rates cannot silently go live
    await dialog.getByLabel("Status").selectOption("PLANNING");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
  }
  await expect(page.getByTestId("event-start")).toHaveText("2027-03-04");

  // --- invoice header / footer: change, see it on an invoice, put it back ---
  await page.getByRole("region", { name: "Invoice header and footer" }).getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Footer: “For …” text").fill("For MCCIA Pune (e2e)");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("For MCCIA Pune (e2e)")).toBeVisible();
  await page.getByRole("link", { name: "Invoices" }).click();
  await page.getByRole("link", { name: /^View/ }).first().click();
  await expect(page.getByTestId("invoice-paper")).toContainText("For MCCIA Pune (e2e)");
  await page.goto("/admin/event");
  await page.getByRole("region", { name: "Invoice header and footer" }).getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Footer: “For …” text").fill("For MCCIA");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Footer: “For MCCIA”")).toBeVisible();

  // --- discount rule + package ---
  await page.getByRole("link", { name: "Discounts and packages" }).click();
  await page.getByRole("button", { name: "Add rule" }).click();
  await page.getByLabel("Rule name").fill("E2E early bird");
  await page.getByLabel("Value (% or ₹)").fill("5");
  await page.getByLabel("Applies from order value (₹)").fill("3000");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("rule-row").filter({ hasText: "E2E early bird" })).toContainText("5%");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete E2E early bird" }).click();
  await expect(page.getByTestId("rule-row").filter({ hasText: "E2E early bird" })).toHaveCount(0);

  await page.getByRole("button", { name: "Add package" }).click();
  await page.getByLabel("Package name").fill("E2E starter pack");
  await page.getByLabel("Product 1").selectOption({ label: "Badges" });
  await page.getByLabel("Quantity 1").fill("50");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("package-card").filter({ hasText: "E2E starter pack" })).toContainText("50 × Badges");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete E2E starter pack" }).click();
  await expect(page.getByTestId("package-card").filter({ hasText: "E2E starter pack" })).toHaveCount(0);

  // --- reports and audit ---
  await page.getByRole("link", { name: "Reports" }).click();
  await expect(page.getByTestId("report-total")).toContainText("invoices");
  await expect(page.getByRole("region", { name: "By branch" }).getByRole("row")).toHaveCount(6); // header + five branches
  await page.getByRole("link", { name: "Audit logs" }).click();
  await page.getByLabel("Filter by type").selectOption("product.");
  await expect(page.getByTestId("audit-row").filter({ hasText: "product.rate_change" }).first()).toBeVisible();

  // --- an ordinary branch user is kept out ---
  const user = await (await browser.newContext()).newPage();
  await user.goto("/login?branch=TIL");
  await user.getByRole("button", { name: "Sign in" }).click();
  await expect(user).toHaveURL(/dashboard/);
  await user.goto("/admin/products");
  await expect(user.getByText("Central admin only")).toBeVisible();
});
