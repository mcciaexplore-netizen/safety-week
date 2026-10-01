import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, code = "SBR") {
  await page.goto(`/login?branch=${code}`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);
}

const sidebar = (page: Page) => page.getByTestId("sidebar");
const toggle = (page: Page) => page.getByTestId("sidebar-toggle");

test("sidebar: open normally, collapsed automatically on the invoice form, collapsible by hand and remembered", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await expect(sidebar(page)).toHaveAttribute("data-collapsed", "0");

  // opening a New Pro Forma collapses it by itself, so the invoice gets the room
  await page.getByRole("link", { name: "New Pro Forma" }).first().click();
  await expect(page).toHaveURL(/invoices\/new/);
  await expect(sidebar(page)).toHaveAttribute("data-collapsed", "1");
  await expect.poll(async () => (await sidebar(page).boundingBox())!.width).toBeLessThan(80); // after the slide animation
  await page.screenshot({ path: "test-results/16a-sidebar-collapsed.png", fullPage: false });
  // collapsed links are still reachable (icons with accessible names)
  await expect(page.getByRole("link", { name: "Invoices", exact: true })).toBeVisible();

  // the user can open it for this visit; it collapses again on the next invoice form
  await toggle(page).click();
  await expect(sidebar(page)).toHaveAttribute("data-collapsed", "0");
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(sidebar(page)).toHaveAttribute("data-collapsed", "0");

  // collapsing by hand elsewhere is remembered across pages and reloads
  await toggle(page).click();
  await expect(sidebar(page)).toHaveAttribute("data-collapsed", "1");
  await page.getByRole("link", { name: "Invoices", exact: true }).click();
  await expect(sidebar(page)).toHaveAttribute("data-collapsed", "1");
  await page.reload();
  await expect(sidebar(page)).toHaveAttribute("data-collapsed", "1");
  await toggle(page).click();
  await expect(sidebar(page)).toHaveAttribute("data-collapsed", "0");
  await page.screenshot({ path: "test-results/16-sidebar-open.png" });
});

test("sidebar: the invoice sheet gets wider when the sidebar is collapsed", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto("/invoices/new");
  await expect(sidebar(page)).toHaveAttribute("data-collapsed", "1");
  const collapsed = (await page.getByTestId("invoice-paper").boundingBox())!.width;
  await toggle(page).click();
  await expect(sidebar(page)).toHaveAttribute("data-collapsed", "0");
  await page.waitForTimeout(400);
  const open = (await page.getByTestId("invoice-paper").boundingBox())!.width;
  expect(collapsed).toBeGreaterThanOrEqual(open);
  await page.screenshot({ path: "test-results/17-new-invoice-collapsed.png" });
});

test("dashboard: Recent invoices is gone; a Low stock card takes its place", async ({ page }) => {
  await signIn(page);
  await expect(page.getByText("Invoices (active)")).toBeVisible();
  await expect(page.getByText("Recent invoices")).toHaveCount(0);
  await expect(page.getByTestId("low-stock-card")).toContainText("Low stock materials");
});

test("invoice bottom: each branch has its own fixed seal, and the rounded-off row is blue", async ({ page }) => {
  for (const [code, name] of [["SBR", "Anjali"], ["TIL", "Rajesh"], ["AHL", "Pooja"]] as const) {
    await page.goto(`/login?branch=${code}`);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/dashboard/);
    await page.goto("/invoices/new");
    const seal = page.getByTestId("branch-seal");
    await expect(seal).toHaveAttribute("src", `/brand/seals/${code}.png`);
    await expect.poll(() => seal.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
    // no UI to change or remove it: it is part of the sheet, not the form
    await expect(page.getByText(name).first()).toBeVisible();
    const blue = await page.getByTestId("paper-rounded").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(blue).toBe("rgb(197, 217, 241)"); // #C5D9F1, the same blue as the header and totals row
    const payBox = await page.getByTestId("paper-payment").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(payBox).toBe("rgb(197, 217, 241)"); // the Payment Details box is blue too (no yellow)
    await page.getByRole("button", { name: "Sign out" }).first().click();
  }
});
