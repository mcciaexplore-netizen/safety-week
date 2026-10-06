import { expect, test, type Page } from "@playwright/test";

/** Runs checks against the proforma shown by the floating Preview button, then closes it again. */
async function inPreview(page: Page, check: () => Promise<void>) {
  await page.getByTestId("floating-preview").click();
  await expect(page.getByTestId("preview-dialog")).toBeVisible();
  await check();
  await page.getByTestId("preview-dialog").getByRole("button", { name: "Close", exact: true }).first().click();
  await expect(page.getByTestId("preview-dialog")).toHaveCount(0);
}
const confirmSubmit = (page: Page) => page.getByTestId("confirm-submit").click();

async function newInvoice(page: Page) {
  await page.goto("/login?branch=TIL");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/invoices/new");
  await page.getByLabel("Company Name", { exact: true }).fill("Payment Test Co");
  // 10 x Ball Pens (Matt Finish) = 350 + 18% = 413 ; 2 x Flags - Normal = 750 + 5% = 787.50 -> payable Rs 1,201
  await page.getByLabel("Quantity for Ball Pens (Matt Finish)", { exact: true }).fill("10");
  await page.getByLabel("Quantity for Flags - Normal", { exact: true }).fill("2");
  await expect(page.getByTestId("form-rounded-total")).toHaveText("₹1,201.00");
}

const paperPayment = (page: Page) => page.getByTestId("paper-payment");

test("payment: one mode takes the full amount automatically and follows the total", async ({ page }) => {
  await newInvoice(page);
  await expect(page.getByTestId("payment-status")).toHaveText("Not paid yet");
  await page.getByLabel("Mode of payment").selectOption("UPI");
  await page.getByLabel("Payment reference").fill("UTR 604794369987");
  await expect(page.getByTestId("payment-status")).toHaveText("Paid in full");
  await inPreview(page, () => expect(paperPayment(page)).toContainText("Payment Details : UPI Rs. 1,201.00 (UTR 604794369987)"));
  // change the order: the payment still equals the payable amount, nothing to re-type
  await page.getByLabel("Quantity for Flags - Normal", { exact: true }).fill("");
  await expect(page.getByTestId("form-rounded-total")).toHaveText("₹413.00");
  await inPreview(page, () => expect(paperPayment(page)).toContainText("UPI Rs. 413.00"));
  await expect(page.getByTestId("payment-status")).toHaveText("Paid in full");
  // every mode is offered, including "Other"
  const options = await page.getByLabel("Mode of payment").locator("option").allTextContents();
  expect(options).toEqual(["Not paid yet", "Cash", "UPI", "Card", "Net banking", "Other"]);
  await page.getByLabel("Mode of payment").selectOption("");
  await inPreview(page, () => expect(paperPayment(page)).not.toContainText("Rs."));
});

test("payment: split between UPI and cash, part payment, over-payment refused, and it survives saving", async ({ page }) => {
  await newInvoice(page);
  await page.getByLabel("Mode of payment").selectOption("UPI");
  await page.getByRole("button", { name: "Split payment" }).click();
  await expect(page.getByTestId("payment-row")).toHaveCount(2);
  await expect(page.getByTestId("payment-summary")).toContainText("balance ₹1,201.00");

  // UPI 500 first ...
  await page.getByLabel("Amount for payment 1").fill("500");
  await page.getByLabel("Reference for payment 1").fill("UTR 111");
  await expect(page.getByTestId("payment-status")).toContainText("Part payment — balance due ₹701.00");
  // ... the rest in cash, with one click
  await page.getByRole("button", { name: "Fill balance on payment 2" }).click();
  await expect(page.getByLabel("Amount for payment 2")).toHaveValue("701");
  await expect(page.getByTestId("payment-status")).toHaveText("Paid in full");
  await inPreview(page, () => expect(paperPayment(page)).toContainText("UPI Rs. 500.00 (UTR 111) + Cash Rs. 701.00"));
  await page.getByTestId("payment-section").screenshot({ path: "test-results/15-split-payment.png" });

  // more than the invoice is refused, and says so live
  await page.getByLabel("Amount for payment 2").fill("900");
  await expect(page.getByTestId("payment-summary")).toContainText("over by ₹199.00");
  await page.getByRole("button", { name: /Save Draft/ }).click();
  await expect(page.getByTestId("error-payments")).toHaveText("The payments add up to more than the invoice total");
  await expect(page.getByTestId("save-state")).not.toContainText("Draft saved");

  // a part payment (less than the total) is allowed: it is saved with a balance due
  await page.getByLabel("Amount for payment 2").fill("200");
  await expect(page.getByTestId("payment-status")).toContainText("balance due ₹501.00");
  await page.getByRole("button", { name: /Save Draft/ }).click();
  await expect(page.getByTestId("save-state")).toContainText("Draft saved");
  await inPreview(page, () => expect(paperPayment(page)).toContainText("UPI Rs. 500.00 (UTR 111) + Cash Rs. 200.00  |  Balance due Rs. 501.00"));

  // reopening shows the split exactly as entered
  await page.reload();
  await expect(page.getByTestId("payment-row")).toHaveCount(2);
  await expect(page.getByLabel("Amount for payment 1")).toHaveValue("500");
  await expect(page.getByLabel("Amount for payment 2")).toHaveValue("200");
  await expect(page.getByLabel("Mode for payment 2")).toHaveValue("CASH");

  // finish it: fill the balance, submit, and the history shows "Paid"
  await page.getByRole("button", { name: "Fill balance on payment 2" }).click();
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await confirmSubmit(page);
  await expect(page.getByText("Invoice submitted")).toBeVisible();
  await page.goto("/invoices");
  await page.getByLabel("Search invoices").fill("Payment Test Co");
  await expect(page.getByTestId("payment-cell").first()).toContainText("Paid");

  // going back to a single payment collapses the rows again
  await page.goBack();
});

test("payment: 'Other' needs a description; back to a single payment", async ({ page }) => {
  await newInvoice(page);
  await page.getByLabel("Mode of payment").selectOption("OTHER");
  await page.getByRole("button", { name: /Save Draft/ }).click();
  await expect(page.getByText("Say how it was paid")).toBeVisible();
  await page.getByLabel("Payment reference").fill("Demand draft 552211");
  await expect(page.getByText("Say how it was paid")).toHaveCount(0);
  await inPreview(page, () => expect(paperPayment(page)).toContainText("Other Rs. 1,201.00 (Demand draft 552211)"));

  await page.getByRole("button", { name: "Split payment" }).click();
  await expect(page.getByTestId("payment-row")).toHaveCount(2);
  await page.getByRole("button", { name: "Back to a single payment" }).click();
  await expect(page.getByTestId("payment-row")).toHaveCount(0);
  await expect(page.getByLabel("Mode of payment")).toHaveValue("OTHER");        // first row kept
  await expect(paperPayment(page)).toContainText("Other Rs. 1,201.00");          // amount back to the full payable
});
