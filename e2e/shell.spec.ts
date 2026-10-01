import { expect, test } from "@playwright/test";

const BRANCHES = ["SB Road", "Tilak Road", "Bhosari", "Hadapsar", "Ahilyanagar"];

test("full shell flow: landing to branch workspace, history, edit, isolation, sign-out", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /National Safety Week 2027/ })).toBeVisible();
  await page.screenshot({ path: "test-results/01-landing.png", fullPage: true });

  await page.getByRole("link", { name: /^National Safety Week 2027$/ }).first().click();
  await expect(page).toHaveURL(/national-safety-week-2027/);
  await page.screenshot({ path: "test-results/02-nsw.png", fullPage: true });

  await page.getByRole("link", { name: /Continue to branch selection/ }).click();
  await expect(page).toHaveURL(/select-branch/);
  for (const b of BRANCHES) await expect(page.getByRole("heading", { name: b }).or(page.getByText(b, { exact: true }).first())).toBeVisible();
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/Sadar|Bhusari/);
  await page.screenshot({ path: "test-results/03-branches.png", fullPage: true });

  await page.getByRole("link", { name: /Tilak Road/ }).click();
  await expect(page).toHaveURL(/login\?branch=TIL/);
  await page.screenshot({ path: "test-results/04-login.png" });
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.getByText("Tilak Road", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Invoices (active)")).toBeVisible();
  await page.screenshot({ path: "test-results/05-dashboard.png", fullPage: true });

  await page.getByRole("link", { name: "Invoices", exact: true }).first().click();
  await expect(page.getByText("NSW27-TIL-000001").first()).toBeVisible();
  await expect(page.getByText("NSW27-SBR-")).toHaveCount(0);
  await page.getByLabel("Search invoices").fill("000003");
  await expect(page.getByRole("link", { name: "NSW27-TIL-000003", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "NSW27-TIL-000001", exact: true })).toHaveCount(0);
  await page.getByLabel("Search invoices").fill("zzzz-none");
  await expect(page.getByText("No invoices match your search")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.screenshot({ path: "test-results/06-history.png", fullPage: true });

  await page.getByRole("link", { name: "NSW27-TIL-000002", exact: true }).click();
  await expect(page.getByRole("heading", { name: "NSW27-TIL-000002", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/07-detail.png", fullPage: true });
  await expect(page.getByRole("button", { name: /Download PDF/ })).toBeVisible();
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(page).toHaveURL(/\/edit$/);

  // branch isolation: another branch's invoice must not load
  await page.goto("/invoices/inv-sbr-000001");
  await expect(page.getByText("Invoice not available")).toBeVisible();

  // create a draft through the real editor
  await page.getByRole("link", { name: "New Pro Forma" }).first().click();
  await page.getByLabel("Company Name", { exact: true }).fill("Shell Flow Industries");
  await page.getByRole("button", { name: /Save Draft/ }).click();
  await expect(page.getByTestId("save-state")).toContainText("Draft saved");
  await expect(page).toHaveURL(/inv-til-000008\/edit/);

  // sign out -> guard
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await expect(page).toHaveURL(/localhost:\d+\/$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/select-branch/);

  expect(errors).toEqual([]);
});

test("login rejects short password and unknown branch is handled", async ({ page }) => {
  await page.goto("/login?branch=HAD");
  await page.getByLabel("Password").fill("ab");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Password must be at least 4")).toBeVisible();
  await page.goto("/login?branch=XXX");
  await expect(page.getByText("Branch not recognised")).toBeVisible();
});

test("mobile layout: menu opens and navigates", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/login?branch=AHL");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("link", { name: "Invoices", exact: true }).click();
  await expect(page).toHaveURL(/\/invoices$/);
  await page.screenshot({ path: "test-results/08-mobile-history.png" });
});
