"use strict";
// P4-S1 oracles: request bounds, declared cache rules, hand-authored OHLC cutoff vectors.
const {test,expect}=require("./fixtures.js");
const bars = fake => fake.log().filter(r=>r.path==="/cube/bars");
const view="#t=2021-01-01T00:00Z~2021-01-01T00:20Z&p=24800~25400&r=2,0&mode=candles";
test("visible candles are bounded, suppress cell tiles, and price/theme changes reuse them",async({page,fakeFor})=>{
 const fake=await fakeFor("micro:bars");await page.goto(fake.url+"/"+view);
 await expect(page.locator("#ol-candle-legend")).toHaveAttribute("data-state","ready");await fake.idle();
 expect(bars(fake).length).toBe(1);for(const r of bars(fake)){expect((+r.query.b1-+r.query.b0)/2**+r.query.n).toBeLessThanOrEqual(4096);}
 expect(fake.log().filter(r=>r.path==="/cube/tile")).toHaveLength(0);
 fake.clearLog();await page.emulateMedia({colorScheme:"dark"});await page.keyboard.press("Shift+]");await fake.idle();
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
 await expect.poll(()=>bars(fake).map(r=>+r.query.n),{timeout:5000}).toContain(4);expect(fake.log().filter(r=>r.path==="/cube/tile")).toHaveLength(0);
 await expect(page.locator("#ol-lens-local")).toBeHidden();await page.keyboard.press("Enter");await expect(page.locator("#ol-mode-text")).toHaveText("Candles");expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("r")).toMatch(/^4,/);
});

test("wide locked views request one centered bounded window and disclose pending outer intervals",async({page,fakeFor})=>{
 const fake=await fakeFor("mini");await page.goto(fake.url+"/#w=7d&r=0,0&mode=candles");
 await expect(page.locator("#ol-candle-legend")).toContainText("outer intervals pending");await fake.idle();
 expect(bars(fake)).toHaveLength(1);const q=bars(fake)[0].query;expect(+q.b1-+q.b0).toBeLessThanOrEqual(4096);
 const cutoff=fake.info().cutoffBase, midpoint=cutoff-7*1536/2;expect(Math.abs((+q.b0+ +q.b1)/2-midpoint)).toBeLessThanOrEqual(2);
 expect(fake.log().filter(r=>r.path==="/cube/tile")).toHaveLength(0);await expect(page.locator("#ol-candle-legend")).toHaveAttribute("data-state","pending");
});

test("a live delta refreshes only the forming candle and retains completed OHLC",async({page,fakeFor})=>{
 const fake=await fakeFor("micro:bars",{next:3});await page.goto(fake.url+"/"+view);
 await expect(page.locator("#ol-candle-legend")).toHaveAttribute("data-state","ready");await fake.idle();
 await page.keyboard.press("t");const first=page.locator('#ol-candle-table tbody tr[data-candle="0"]');const before=await first.textContent();
 fake.clearLog();fake.advance({minutes:2,trades:[{t_ms:1250000,price:2625000,qty:400000,takerBuy:true}]});
 const last=page.locator('#ol-candle-table tbody tr[data-candle="5"]');await expect(last.locator("td").nth(4)).toHaveText("26,250",{timeout:10000});await fake.idle();
 expect(await first.textContent()).toBe(before);expect(bars(fake)).toHaveLength(1);expect(+bars(fake)[0].query.b0).toBe(20);expect(+bars(fake)[0].query.b1).toBe(23);
});

test("a whole pack replacement preserves the exact replay edge and cannot expose new future trades",async({page,fakeFor})=>{
 const fake=await fakeFor("micro:bars",{next:3});const replay=view.replace("r=2,0","r=8,0")+"&replay=1&at=2021-01-01T00:01:40.001Z";await page.goto(fake.url+"/"+replay);
 await expect(page.locator("#ol-candle-legend")).toHaveAttribute("data-state","ready");await page.keyboard.press("t");
 const row=page.locator('#ol-candle-table tbody tr[data-candle="0"]');await expect(row.locator("td").nth(4)).toHaveText("24,875");await fake.idle();fake.clearLog();
 fake.holdPacks(1);fake.advance({minutes:2,trades:[{t_ms:1250000,price:2625000,qty:400000,takerBuy:true}]});
 await expect.poll(()=>fake.log().filter(r=>r.path==="/cube/pack"&&r.answer==="pack").length,{timeout:10000}).toBe(1);
 await expect.poll(()=>bars(fake).length,{timeout:10000}).toBe(1);await expect(page.locator("#ol-candle-legend")).toHaveAttribute("data-state","ready");await fake.idle();
 expect(+bars(fake)[0].query.b1).toBeCloseTo(100001/56250,9);await expect(row.locator("td").nth(2)).toHaveText("25,375");await expect(row.locator("td").nth(4)).toHaveText("24,875");await expect(row).toContainText("So far");
});
