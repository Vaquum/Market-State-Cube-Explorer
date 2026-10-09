"use strict";
// A failed history read is a source failure, not an instruction to choose another anchor.
const { test, expect } = require("./fixtures.js");

test("continuations preserve the history failure in the summary, details and cases", async ({ page, fakeFor, allowConsole }) => {
  const fake = await fakeFor("mini");
  const reason = "column history coverage unavailable";
  const failure = fake.on({ route: "/cube/columns" }).fail({ status: 503, body: { error: reason } });
  allowConsole(/Failed to load resource.*503/);
  await page.goto(`${fake.url}/#w=24h&r=5,0&auto=0&vis=2&tab=continuations`);

  const message = `History unavailable: ${reason}`;
  await expect(page.locator("#ol-evidence-brief")).toHaveText(message);
  await expect(page.locator("#ol-state")).toHaveText(message);
  await expect(page.locator("#ol-evidence")).toHaveAttribute("aria-busy", "false");
  expect(failure.hits).toBeGreaterThan(0);

  await page.locator("#ol-evidence-info").click();
  await expect(page.locator("#ol-evidence-note")).toHaveText(message);
  await expect(page.locator("#ol-evidence-more")).not.toContainText("Choose a completed column containing trades");
  await page.keyboard.press("Escape");
  await page.locator("#ol-open-cases").click();
  await expect(page.locator("#ol-case-definition")).toHaveText(message);
  await expect(page.locator("#ol-case-page")).toHaveText("0 cases");
});
