"use strict";
const {test,expect}=require("./fixtures.js");
// P4-S1 oracle: the saved address and explicit recorded unavailability, independent of a rendered baseline.
test("fresh addresses and last view preserve Candles and return to Volume",async({page,fakeFor,freshContext})=>{
 const fake=await fakeFor("mini");await page.goto(fake.url+"/#w=24h&mode=candles");await expect(page.locator("#ol-mode-text")).toHaveText("Candles");await expect(page.locator("#ol-candle-legend")).toHaveAttribute("data-state","ready");
 await page.reload();await expect(page.locator("#ol-mode-text")).toHaveText("Candles");const url=page.url();const context=await freshContext();const other=await context.newPage();await other.goto(url);await expect(other.locator("#ol-mode-text")).toHaveText("Candles");await other.keyboard.press("k");await expect(other.locator("#ol-mode-text")).toHaveText("Volume");await other.close();
});
test("recorded candle address remains named with explicit unavailable state and disabled choice",async({page,fakeFor})=>{
 const fake=await fakeFor("recorded");await page.goto(fake.url+"/#w=24h&mode=candles");await expect(page.locator("#ol-mode-text")).toHaveText("Candles");await expect(page.locator("#ol-candle-legend")).toContainText("Live cube only");await expect(page.locator("#ol-candle-legend")).toHaveAttribute("data-state","unavailable");
 await page.locator("#ol-mode").click();await expect(page.locator('[data-mode="candles"]')).toHaveAttribute("aria-disabled","true");await expect(page.locator('[data-mode="candles"]')).toContainText("Live cube only");await page.keyboard.press("Escape");await page.keyboard.press("k");await expect(page.locator("#ol-mode-text")).toHaveText("Volume");
});
