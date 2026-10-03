"use strict";
// P4-S1 oracles: request bounds, declared cache rules, hand-authored OHLC cutoff vectors.
const {test,expect}=require("./fixtures.js");
const bars = fake => fake.log().filter(r=>r.path==="/cube/bars");
const view="#t=2021-01-01T00:00Z~2021-01-01T00:20Z&p=24800~25400&r=2,0&mode=candles";
test("visible candles are bounded, suppress cell tiles, and price/theme changes reuse them",async({page,fakeFor})=>{
 const fake=await fakeFor("micro:bars");await page.goto(fake.url+"/"+view);
 await expect(page.locator("#ol-candle-legend")).toHaveAttribute("data-state","ready");await fake.idle();
 expect(bars(fake).length).toBe(1);for(const r of bars(fake)){expect((+r.query.b1[0]-+r.query.b0[0])/2**+r.query.n[0]).toBeLessThanOrEqual(4096);}
 expect(fake.log().filter(r=>r.path==="/cube/tile")).toHaveLength(0);
 fake.clearLog();await page.emulateMedia({colorScheme:"dark"});await page.keyboard.press("}");await fake.idle();
 expect(bars(fake)).toHaveLength(0);
 await page.keyboard.press("k");await fake.idle();fake.clearLog();await page.emulateMedia({colorScheme:"light"});await fake.idle();expect(bars(fake)).toHaveLength(0);
});
test("rewind and advance inside a cached candle cannot expose a future trade",async({page,fakeFor})=>{
 const fake=await fakeFor("micro:bars");await page.goto(fake.url+"/"+view);await expect(page.locator("#ol-candle-legend")).toHaveAttribute("data-state","ready");
 for(const [at,close] of [["2021-01-01T00:01:40.000Z","25,375"],["2021-01-01T00:01:40.001Z","24,875"],["2021-01-01T00:00:01.000Z",null],["2021-01-01T00:00:01.001Z","25,375"]]){
  await page.evaluate(hash=>{location.hash=hash},view+"&replay=1&at="+at);
  await expect(page.locator("#ol-candle-legend")).toHaveAttribute("data-state","ready");await fake.idle();
  await page.keyboard.press("t");
  const row=page.locator('#ol-candle-table tbody tr[data-candle="0"]');
  if(close===null)await expect(row).toHaveCount(0);else{await expect(row.locator("td").nth(4)).toHaveText(close);await expect(row).toContainText("So far");}
  await page.keyboard.press("t");
 }
});
test("failed candles retain an explicit state and a departed mode discards delayed answers",async({page,fakeFor,allowConsole})=>{
 const fake=await fakeFor("micro:bars");const gate=fake.on({route:"/cube/bars"}).gate();
 await page.goto(fake.url+"/"+view);await gate.arrived();await expect(page.locator("#ol-candle-legend")).toHaveAttribute("data-state","pending");
 await page.keyboard.press("k");gate.open();await fake.idle();await expect(page.locator("#ol-mode-text")).toHaveText("Volume");await expect(page.locator("#ol-candle-legend")).toBeHidden();
 fake.clearFaults();allowConsole(/Failed to load resource.*500/);const failure=fake.on({route:"/cube/bars"}).fail({status:500,body:{error:"candle fault"}});
 await page.keyboard.press("]");await page.keyboard.press("k");await expect(page.locator("#ol-candle-legend")).toHaveAttribute("data-state","failed");await expect(page.locator("#ol-candle-legend")).toContainText("candle fault");failure.remove();
});
test("lens asks its own finer timeframe with no lens cell tile and Pin promotes it",async({page,fakeFor})=>{
 const fake=await fakeFor("mini");await page.goto(fake.url+"/#w=24h&r=6,3&mode=candles");await expect(page.locator("#ol-candle-legend")).toHaveAttribute("data-state","ready");await fake.idle();fake.clearLog();
 await page.keyboard.press("l");const box=await page.locator("#ol-canvas").boundingBox();await page.mouse.move(box.x+box.width*.45,box.y+box.height*.4);await fake.idle();
 await expect.poll(()=>bars(fake).map(r=>+r.query.n[0]),{timeout:5000}).toContain(4);expect(fake.log().filter(r=>r.path==="/cube/tile")).toHaveLength(0);
 await expect(page.locator("#ol-lens-local")).toBeHidden();await page.keyboard.press("Enter");await expect(page.locator("#ol-mode-text")).toHaveText("Candles");expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("r")).toMatch(/^4,/);
});
