"use strict";
// Authentic canonical June 27 output. The existing fake supplies GUI geometry only.
const {test,expect}=require("./fixtures.js");
const record=require("../fixtures/rallies/canonical.json");
const camera=url=>new URLSearchParams(new URL(url).hash.slice(1)).get("t");
async function setup(page,fake){
 await page.goto(fake.url+"/#t=2026-06-27T11:39:00Z~2026-06-27T11:55:00Z&p=60000~60625&r=0,0");
 await page.locator("#ol-tab-rallies").click();
 await page.locator("#ol-rally-start").fill("2026-06-27T11:39");await page.locator("#ol-rally-end").fill("2026-06-27T11:55");
}
async function discover(page,fake){await setup(page,fake);await page.locator("#ol-rally-discover").click();await expect(page.locator("#ol-rally-rows tr")).toHaveCount(4);}
test("discovery, exact members, deadline and zoom reuse one canonical result without moving the camera",async({page,fakeFor})=>{
 const fake=await fakeFor("mini");await discover(page,fake);const before=camera(page.url());
 await page.locator("#ol-rally-rows button").first().click();const inspector=page.locator("#ol-rally-inspector");
 await expect(inspector).toContainText("9,792");await expect(inspector).toContainText("6453964086 → 6453973877");
 await expect(inspector).toContainText("29.98 USDT");expect(camera(page.url())).toEqual(before);
 const viewsBefore=fake.log().filter(e=>e.path==="/cube/rallies/view").length;
 await page.locator("#ol-rally-deadline").fill("4");await page.locator("#ol-rally-deadline").dispatchEvent("change");
 await expect(page.locator("#ol-rally-rows tr")).toHaveCount(2);await expect(inspector).toContainText("Hidden by replay or time-to-target filter");
 await page.locator("#ol-rally-deadline").fill("240");await page.locator("#ol-rally-deadline").dispatchEvent("change");
 await expect(inspector).toContainText("9,792");expect(fake.log().filter(e=>e.path==="/cube/rallies/view")).toHaveLength(viewsBefore);
 await page.locator("#ol-tab-rallies").focus();await page.keyboard.press("]");await expect(inspector).toContainText("9,792");
 expect(fake.log().filter(e=>e.path==="/cube/rallies" && e.method==="POST")).toHaveLength(1);
});
test("replay keeps member measurements while a view response takes longer than a tick",async({page,fakeFor})=>{
 const fake=await fakeFor("mini");await discover(page,fake);await fake.idle();
 fake.on("/cube/rallies/view").delay(1500);
 const before=fake.log().filter(e=>e.path==="/cube/rallies/view").length;
 await page.locator("#ol-rally-rows button").first().click();await page.locator("#ol-replay").click();await page.locator("#ol-play").click();
 await expect(page.locator("#ol-rally-inspector")).toContainText("9,792");await expect(page.locator("#ol-play")).toHaveAttribute("aria-pressed","true");
 expect(fake.log().filter(e=>e.path==="/cube/rallies/view")).toHaveLength(before+1);
 await page.locator("#ol-play").click();
});
test("inactive mode fields do not participate in native form validation",async({page,fakeFor})=>{
 const fake=await fakeFor("mini");await setup(page,fake);
 await page.locator("#ol-rally-mode").selectOption("controlled_advance");await page.locator("#ol-rally-pullback").fill("");await page.locator("#ol-rally-mode").selectOption("first_hit");
 await page.locator("#ol-rally-discover").click();await expect(page.locator("#ol-rally-rows tr")).toHaveCount(4);
 await page.locator("#ol-rally-cadence").fill("");await page.locator("#ol-rally-mode").selectOption("swing");
 fake.on("/cube/rallies").fail(503,{error:"recorded_boundary_busy"});
 const request=page.waitForRequest(r=>new URL(r.url()).pathname==="/cube/rallies" && r.method()==="POST");
 await page.locator("#ol-rally-discover").click();expect((await request).postDataJSON().definition).toEqual({mode:"swing",scale:"bps",target:30,reversal:10});
 await expect(page.locator("#ol-rally-status")).toContainText("503");await expect(page.locator("#ol-rally-discover")).toBeEnabled();
});
test("a stalled discovery times out and releases the GUI read pause",async({page,fakeFor})=>{
 const fake=await fakeFor("mini");await setup(page,fake);await fake.idle();await page.clock.install();
 fake.on("/cube/rallies").hang();await page.locator("#ol-rally-discover").click();await expect(page.locator("#ol-rally-discover")).toBeDisabled();
 await page.clock.fastForward(330001);await expect(page.locator("#ol-rally-discover")).toBeEnabled();await expect(page.locator("#ol-rally-status")).toContainText("Request timed out");
});
test("recorded page declares native discovery unavailable",async({page,fakeFor})=>{
 const fake=await fakeFor("recorded");await page.goto(fake.url);await page.locator("#ol-tab-rallies").click();
 await expect(page.locator("#ol-rally-discover")).toBeDisabled();await expect(page.locator("#ol-rally-status")).toContainText("requires the live Origo cube");
});
