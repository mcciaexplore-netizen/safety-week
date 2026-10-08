import { expect, test } from "@playwright/test";

// Real API with Razorpay TEST keys set on it (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET); see api.spec.ts for the rest of the set-up.
test.skip(!process.env.API_E2E || !process.env.RAZORPAY_E2E, "needs the real API with Razorpay test keys (set API_E2E=1 and RAZORPAY_E2E=1)");
test.setTimeout(120_000);

test("proforma: staff are offered only Cash and Razorpay UPI; Razorpay UPI shows a QR for the exact amount and waits for payment", async ({ page }) => {
  await page.goto("/login?branch=TIL");
  await page.getByLabel("User ID / e-mail").fill("rajesh@example.invalid");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/invoices/new");
  await page.getByLabel("Company Name", { exact: true }).fill("Counter Co");
  await page.getByLabel("Quantity for Badges", { exact: true }).fill("10");   // 10 x 4.80 + 18% = 56.64 -> Rs 57

  const mode = page.getByLabel("Mode of payment");
  expect(await mode.locator("option").allTextContents()).toEqual(["Not paid yet", "Cash", "Razorpay UPI"]);
  await mode.selectOption("RAZORPAY");
  await expect(page.getByLabel("Payment reference")).toHaveAttribute("readonly", "");   // the id is never typed by hand
  await page.getByTestId("show-qr").click();
  await expect(page.getByTestId("qr-image")).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("razorpay-collect")).toContainText("₹57.00");
  await expect(page.getByTestId("razorpay-collect")).toContainText("Waiting for payment");
  await page.screenshot({ path: "test-results/26-counter-qr.png", fullPage: true });

  // submitting before the customer has paid is refused by the server
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await page.getByTestId("confirm-submit").click();
  await expect(page.getByTestId("form-error")).toContainText("Razorpay");

  // changing the amount makes the old QR stale
  await page.getByLabel("Quantity for Badges", { exact: true }).fill("20");
  await expect(page.getByTestId("razorpay-collect")).toContainText("amount changed");
});
