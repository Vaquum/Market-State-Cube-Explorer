"use strict";
// Authentic canonical June 27 output. The existing fake supplies GUI geometry only.
const {test,expect}=require("./fixtures.js");
const record=require("../fixtures/rallies/canonical.json");
const camera=url=>new URLSearchParams(new URL(url).hash.slice(1)).get("t");
async function discover(page,fake){
 await page.goto(fake.url+"/#t=2026-06-27T11:39:00Z~2026-06-27T11:55:00Z&p=60000~60625&r=0,0");
 await page.locator("#ol-tab-rallies").click();
 await page.locator("#ol-rally-start").fill("2026-06-27T11:39");await page.locator("#ol-rally-end").fill("2026-06-27T11:55");
 await page.locator("#ol-rally-discover").click();await expect(page.locator("#ol-rally-rows tr")).toHaveCount(4);
}
test("discovery, exact members, deadline and zoom reuse one canonical result without moving the camera",async({page,fakeFor})=>{
 const fake=await fakeFor("mini");await discover(page,fake);const before=camera(page.url());
 await page.locator("#ol-rally-rows button").first().click();const inspector=page.locator("#ol-rally-inspector");
 await expect(inspector).toContainText("9,792");await expect(inspector).toContainText("6453964086 → 6453973877");
 await expect(inspector).toContainText("29.98 USDT");expect(camera(page.url())).toEqual(before);
 await page.locator("#ol-rally-deadline").fill("4");await page.locator("#ol-rally-deadline").dispatchEvent("change");
 await expect(page.locator("#ol-rally-rows tr")).toHaveCount(2);await expect(inspector).toContainText("Hidden by replay or time-to-target filter");
 await page.locator("#ol-rally-deadline").fill("240");await page.locator("#ol-rally-deadline").dispatchEvent("change");
 await expect(inspector).toContainText("9,792");await page.locator("#ol-tab-rallies").focus();await page.keyboard.press("]");await expect(inspector).toContainText("9,792");
 expect(fake.log().filter(e=>e.path==="/cube/rallies" && e.method==="POST")).toHaveLength(1);
});
test("recorded page declares native discovery unavailable",async({page,fakeFor})=>{
 const fake=await fakeFor("recorded");await page.goto(fake.url);await page.locator("#ol-tab-rallies").click();
 await expect(page.locator("#ol-rally-discover")).toBeDisabled();await expect(page.locator("#ol-rally-status")).toContainText("requires the live Origo cube");
});
