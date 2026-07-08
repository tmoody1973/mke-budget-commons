import { test, expect, type Page } from "@playwright/test";

/**
 * Trust E2E for the budget agent. The one promise this app makes: every dollar
 * figure on screen is sourced to a document page, and the model never invents a
 * number. These tests are the automated guard on that promise.
 *
 * The invariant we assert everywhere: any rendered card that shows a figure
 * (`[data-figure]`) must also carry at least one citation chip (`[data-citation]`)
 * in the same card (`[data-testid="cited-card"]`).
 */

/** Assert the trust invariant over every cited-card currently on the page. */
async function assertEveryFigureIsCited(page: Page) {
  const report = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-testid="cited-card"]')];
    return cards.map((c) => ({
      figures: c.querySelectorAll("[data-figure]").length,
      citations: c.querySelectorAll("[data-citation]").length,
    }));
  });
  // At least one card with a figure must exist (else nothing rendered — a real bug).
  const withFigures = report.filter((c) => c.figures > 0);
  expect(withFigures.length, "expected at least one card with a figure").toBeGreaterThan(0);
  // Every figure-bearing card must carry a citation.
  for (const c of withFigures) {
    expect(c.citations, "a card showed a figure with no citation").toBeGreaterThan(0);
  }
}

test.describe("dashboard trust invariant (no API key needed)", () => {
  for (const gov of ["city", "county", "mps"] as const) {
    test(`every figure is cited — ${gov}`, async ({ page }) => {
      await page.goto(`/?gov=${gov}`);
      // Trust bar is the header signal; it renders on every government view.
      await expect(page.getByTestId("trust-bar")).toBeVisible();
      // Cards are server-rendered from reconciled data; wait for at least one.
      await expect(page.getByTestId("cited-card").first()).toBeVisible();
      await assertEveryFigureIsCited(page);
      // And a coarse promise check: at least one citation chip is present.
      await expect(page.locator("[data-citation]").first()).toBeVisible();
    });
  }
});

test.describe("copilot investigation (needs ANTHROPIC_API_KEY + DB)", () => {
  test.skip(
    !process.env.ANTHROPIC_API_KEY,
    "ANTHROPIC_API_KEY not set — skipping the live copilot investigation test",
  );

  test("asking for the biggest changes renders a cited card in the chat", async ({ page }) => {
    test.setTimeout(120_000); // a real multi-step LLM investigation

    await page.goto("/");
    const dashboardCards = await page.getByTestId("cited-card").count();

    // The CopilotSidebar may start open or closed; ensure the input is available.
    const input = page.getByPlaceholder("Type a message...");
    if (!(await input.isVisible().catch(() => false))) {
      await page.locator("button.copilotKitButton").first().click();
    }
    await expect(input).toBeVisible();

    await input.fill("What changed most in the city budget from 2025 to 2026?");
    await input.press("Enter");

    // Wait for the copilot to call biggest_changes and render a new cited card
    // in the chat stream (beyond the ones already on the dashboard).
    await expect
      .poll(async () => page.getByTestId("cited-card").count(), { timeout: 90_000 })
      .toBeGreaterThan(dashboardCards);

    // The core assertion: whatever the model rendered, no figure is uncited.
    await assertEveryFigureIsCited(page);
  });
});
