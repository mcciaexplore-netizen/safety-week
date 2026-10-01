import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, code = "SBR") {
  await page.goto(`/login?branch=${code}`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);
}

const paper = (page: Page, id: string) => page.getByTestId(id);
const company = (page: Page) => page.getByLabel("Company Name", { exact: true });
const qty = (page: Page, material: string) => page.getByLabel(`Quantity for ${material}`, { exact: true });

test("editor: the invoice sheet is the order form; preview only after saving", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await signIn(page);
  await page.goto("/invoices/new");
  await expect(page.getByTestId("invoice-paper")).toBeVisible();
  await expect(paper(page, "paper-invoice-no")).toContainText("NSW27-SBR-");
  // all 39 catalogue rows are on the sheet from the start, each with an empty Qty. cell
  await expect(page.getByTestId("qty-input")).toHaveCount(39);
  await expect(paper(page, "invoice-paper")).toContainText("Water Bottle");
  await expect(page.getByTestId("preview-title")).toHaveCount(0); // no preview while filling in
  await page.screenshot({ path: "test-results/10-editor-blank.png" });

  // customer details on the left appear on the sheet immediately
  await company(page).fill("Test Industries Pvt. Ltd.");
  await expect(paper(page, "paper-company")).toContainText("Company Name  : Test Industries Pvt. Ltd.");
  await page.getByLabel("Address", { exact: true }).fill("Plot 5, Bhosari MIDC");
  await page.getByLabel("GSTIN", { exact: true }).fill("27AABCT1234A1Z5");
  await page.getByLabel("Email ID", { exact: true }).fill("accounts@test.example");
  await page.getByLabel("Contact Person & Cell No — name").fill("A. Kulkarni");
  await page.getByLabel("Contact Person & Cell No — cell no").fill("9800011111");
  await expect(paper(page, "paper-address")).toContainText("Address : Plot 5, Bhosari MIDC");
  await expect(paper(page, "paper-gstin")).toHaveText("27AABCT1234A1Z5");
  await expect(paper(page, "paper-email")).toHaveText("accounts@test.example");
  await expect(paper(page, "paper-contact")).toContainText("A. Kulkarni 9800011111");
  await page.getByLabel("Proforma Invoice Date").fill("2027-02-12");
  await expect(paper(page, "paper-date")).toHaveText("12/Feb/2027");

  // click a Qty. cell and type: the amounts are computed right there
  await qty(page, "Ball Pens (Matt Finish)").fill("3");
  await expect(paper(page, "paper-grand-total")).toHaveText("123.90"); // 35 x 3 = 105 + 9% + 9%
  await expect(paper(page, "paper-rounded")).toHaveText("124.00");
  await expect(paper(page, "paper-words")).toContainText("One Hundred Twenty Four only");
  await expect(page.getByTestId("form-rounded-total")).toHaveText("₹124.00");
  await qty(page, "Ball Pens (Matt Finish)").fill("10");
  await expect(paper(page, "paper-grand-total")).toHaveText("413.00");
  await qty(page, "Flags - Normal").fill("2"); // a 2.5% + 2.5% GST row
  await expect(paper(page, "paper-grand-total")).toHaveText("1,200.50"); // 413.00 + 787.50
  await expect(paper(page, "paper-rounded")).toHaveText("1,201.00");
  await expect(page.getByTestId("qty-input")).toHaveCount(39); // untouched rows stay on the sheet

  // discount adds the "Rate after Discount" column (workbook variant B)
  await expect(paper(page, "invoice-paper").getByText("Rate after Discount")).toHaveCount(0);
  await page.getByLabel("Discount on rate (%)").fill("10");
  await expect(paper(page, "paper-discount")).toHaveText("10%");
  await expect(paper(page, "invoice-paper").getByText("Rate after Discount")).toBeVisible();
  await expect(paper(page, "paper-grand-total")).toHaveText("1,080.45"); // 1200.50 x 0.9
  await page.getByLabel("Discount on rate (%)").fill("");
  await expect(paper(page, "paper-grand-total")).toHaveText("1,200.50");
  await page.screenshot({ path: "test-results/11-editor-filled.png" });

  // clearing a Qty. removes that material
  await qty(page, "Flags - Normal").fill("");
  await expect(paper(page, "paper-grand-total")).toHaveText("413.00");

  // Save Draft -> now (and only now) the preview is shown; "Edit quantities" goes back to the sheet
  await page.getByRole("button", { name: /Save Draft/ }).click();
  await expect(page.getByTestId("save-state")).toContainText("Draft saved");
  await expect(page.getByTestId("preview-title")).toBeVisible();
  await expect(page.getByTestId("qty-input")).toHaveCount(0);
  await expect(paper(page, "invoice-paper")).toContainText("Water Bottle"); // the preview still lists every item
  await page.screenshot({ path: "test-results/11b-preview-after-save.png" });
  await page.getByTestId("edit-quantities").click();
  await expect(page.getByTestId("qty-input")).toHaveCount(39);
  await expect(page).toHaveURL(/\/invoices\/inv-sbr-\d+\/edit/);
  const url = page.url();
  await page.goto("/invoices");
  await page.getByLabel("Search invoices").fill("Test Industries");
  await expect(page.getByText("Test Industries Pvt. Ltd.")).toBeVisible();
  await page.goto(url);
  await expect(company(page)).toHaveValue("Test Industries Pvt. Ltd.");
  await expect(page.getByLabel("Proforma Invoice Date")).toHaveValue("2027-02-12");
  await expect(qty(page, "Ball Pens (Matt Finish)")).toHaveValue("10");
  await expect(paper(page, "paper-grand-total")).toHaveText("413.00");
  await expect(page.getByTestId("save-state")).toContainText("All changes saved");

  // edit again -> unsaved indicator; reset asks for confirmation and restores
  await company(page).fill("Changed Name");
  await expect(page.getByTestId("save-state")).toHaveText("Unsaved changes");
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByText("Discard your changes?")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(company(page)).toHaveValue("Changed Name");
  await page.getByRole("button", { name: "Reset" }).click();
  await page.getByTestId("confirm-reset").click();
  await expect(company(page)).toHaveValue("Test Industries Pvt. Ltd.");

  // submit -> success dialog -> status becomes Submitted; the saved invoice page lists every item too
  await page.getByLabel("Payment Details").fill("UTR - 123456789012  A Payer");
  await expect(paper(page, "paper-payment")).toContainText("Payment Details : UTR - 123456789012  A Payer");
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByText("Invoice submitted")).toBeVisible();
  await page.getByRole("link", { name: "View invoice" }).click();
  await expect(paper(page, "paper-company")).toContainText("Test Industries Pvt. Ltd.");
  await expect(paper(page, "invoice-paper")).toContainText("Water Bottle");
  await expect(page.getByText("Submitted", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: "test-results/12-invoice-view.png", fullPage: true });

  // revising a submitted invoice needs a reason and produces an Edited version 2
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await qty(page, "Ball Pens (Matt Finish)").fill("11");
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(page.getByTestId("error-editReason")).toHaveText("Give a reason for the change");
  await page.getByLabel("Reason for this change").fill("customer changed the quantity");
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(page.getByText("Revision saved")).toBeVisible();

  expect(errors).toEqual([]);
});

test("editor: keyboard-friendly entry, validation on submit, no cross-branch access", async ({ page }) => {
  await signIn(page, "HAD");
  await page.goto("/invoices/new");
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByTestId("error-companyName")).toHaveText("Company name is required");
  await expect(page.getByTestId("error-items")).toHaveText("Add at least one material with a quantity");

  // Tab moves from one Qty. cell straight to the next row, so a whole order can be typed without the mouse
  await qty(page, "Badges").click();
  await page.keyboard.type("100");
  await page.keyboard.press("Tab");
  await page.keyboard.type("5"); // Ball Pens
  await page.keyboard.press("Tab");
  await page.keyboard.type("7"); // Ball Pens (Matt Finish)
  await expect(qty(page, "Ball Pens")).toHaveValue("5");
  await expect(qty(page, "Ball Pens (Matt Finish)")).toHaveValue("7");
  await expect(paper(page, "paper-grand-total")).toHaveText("973.50"); // (100 x 4.80 + 5 x 20 + 7 x 35) x 1.18
  await expect(page.getByTestId("error-items")).toHaveCount(0);

  await company(page).fill("X Ltd");
  await page.getByLabel("GSTIN", { exact: true }).fill("BADGSTIN");
  await expect(page.getByTestId("error-gstin")).toHaveText("Enter a valid 15-character GSTIN");
  await page.getByLabel("Email ID", { exact: true }).fill("not-an-email");
  await expect(page.getByTestId("error-email")).toBeVisible();

  // an SBR invoice id must not open in the Hadapsar workspace
  await page.goto("/invoices/inv-sbr-000001/edit");
  await expect(page.getByText("Invoice not available")).toBeVisible();
});

test("editor: on a phone the page is one column, top to bottom", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "BHO");
  await page.goto("/invoices/new");
  await company(page).fill("Mobile Co");
  await expect(page.getByTestId("paper-company")).toContainText("Mobile Co");
  await qty(page, "Badges").scrollIntoViewIfNeeded();
  await qty(page, "Badges").fill("10");
  await expect(page.getByTestId("form-rounded-total")).toHaveText("₹57.00");
  await page.screenshot({ path: "test-results/13-editor-mobile.png" });
});

test("editor: layout order is customer, invoice details, the sheet, then the summary", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await signIn(page, "SBR");
  await page.goto("/invoices/new");
  const y = async (loc: ReturnType<Page["locator"]>) => (await loc.boundingBox())!.y;
  const customer = await y(page.getByRole("heading", { name: "Customer information" }));
  const details = await y(page.getByRole("heading", { name: "Invoice information" }));
  const sheet = await y(page.getByTestId("invoice-paper"));
  const summary = await y(page.getByRole("heading", { name: "Summary and footer" }));
  expect(customer).toBeLessThan(details);
  expect(details).toBeLessThan(sheet);
  expect(sheet).toBeLessThan(summary);
  const box = (await page.getByTestId("invoice-paper").boundingBox())!;
  expect(box.width).toBeGreaterThan(900); // the sheet is shown big (scaled up), not squeezed beside the form
  await page.screenshot({ path: "test-results/14-layout-top-to-bottom.png", fullPage: true });
});

test("history: date filter, download, edit an existing invoice from history", async ({ page }) => {
  await signIn(page, "SBR");
  await page.goto("/invoices");
  await expect(page.getByRole("link", { name: "NSW27-SBR-000001", exact: true })).toBeVisible();
  await page.getByLabel("Invoice date from").fill("2027-02-01");
  await expect(page.getByRole("link", { name: "NSW27-SBR-000001", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "NSW27-SBR-000009", exact: true })).toBeVisible();
  await page.getByLabel("Invoice date to").fill("2027-01-01");
  await expect(page.getByText("No invoices match your search")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();

  await page.getByLabel("Search invoices").fill("000003");
  // demo mode: Download opens the invoice page with the browser print dialog (Save as PDF)
  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "Download PDF for NSW27-SBR-000003" }).click(),
  ]);
  expect(popup.url()).toMatch(/\/invoices\/inv-sbr-000003\?print=1$/);
  await popup.close();
  const name = await page.locator("tbody tr td").nth(2).innerText();
  await page.getByRole("link", { name: "Edit NSW27-SBR-000003" }).click();
  await expect(company(page)).toHaveValue(name);
  await expect(paper(page, "paper-company")).toContainText(name);
  await expect(paper(page, "paper-invoice-no")).toHaveText("NSW27-SBR-000003");
  // the seeded quantities are already typed into the sheet's cells
  const filled = await page
    .getByTestId("qty-input")
    .evaluateAll((els) => els.filter((e) => (e as HTMLInputElement).value !== "").length);
  expect(filled).toBeGreaterThan(0);
});
