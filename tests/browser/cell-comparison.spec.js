"use strict";
// PRD-0006 D1/D6: the real chart routes feed owned canonical captures.
// Oracles: pre-action address/history, canonical Cells fields, source intervals and fake request log.
const {test,expect}=require("./fixtures.js");
const {atRest}=require("./rows-support.js");
const KEY="market-state-cube-explorer:comparison:v1:BTC/USDT";
async function open(page,fake,probe,extra="") {
  await page.goto(`${fake.url}/#w=24h&vis=2&n=4&m=0&auto=0&poc=0&lines=${extra}`);
  await atRest(page,fake,probe);await probe.waitForQuiet({quietMs:300,timeout:60000});
}
async function point(page) {
  const box=await page.locator("#ol-canvas").boundingBox(),layout=await page.locator("#ol-canvas").getAttribute("data-layout"),a=layout.split(",").map(Number);
  return {x:box.x+a[0]+a[2]*.38,y:box.y+a[1]+a[3]*.48};
}
async function stored(page) {return page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),KEY);}
async function menu(page,p) {await page.mouse.click(p.x,p.y,{button:"right"});await expect(page.locator("#ol-cell-menu")).toBeVisible();}
async function add(page,p) {await menu(page,p);await page.getByRole("menuitem",{name:"Add to comparison"}).click();await expect(page.locator("#ol-tab-compare")).toContainText("1");await expect.poll(async()=> (await stored(page))?.captures?.length).toBe(1);}

test("secondary menu/cancel/Copy leave the chart address, anchor and history unchanged",async({page,fakeFor,probe})=>{
  const fake=await fakeFor("standard");await open(page,fake,probe);const p=await point(page);
  const before=await page.evaluate(()=>({hash:location.hash,history:sessionStorage.getItem("market-state-cube-explorer:history:v1")}));
  await menu(page,p);await page.keyboard.press("Escape");await expect(page.locator("#ol-cell-menu")).toHaveCount(0);
  expect(await page.evaluate(()=>location.hash)).toBe(before.hash);
  await menu(page,p);await page.getByRole("menuitem",{name:"Copy cell"}).click();
  expect((await stored(page))?.captures.length??0).toBe(0);
  expect(await page.evaluate(()=>location.hash)).toBe(before.hash);
  expect(await page.evaluate(()=>sessionStorage.getItem("market-state-cube-explorer:history:v1"))).toBe(before.history);
});
for(const tool of ["pan","select","inspect","trend"])
  test(`right-click in ${tool} collects without its primary gesture`,async({page,fakeFor,probe})=>{
    const fake=await fakeFor("standard");await open(page,fake,probe);await page.locator(`[data-tool="${tool}"]`).click();
    const p=await point(page),before=await page.evaluate(()=>location.hash);await add(page,p);
    expect(await page.evaluate(()=>location.hash)).toBe(before);
    const record=await stored(page);expect(record.captures[0].metrics["volume.amount"].tag).toBe("finite");
    expect(record.captures[0].id).toContain("BTC/USDT");expect(record.captures[0].observed.seconds).toBeGreaterThan(0);
  });

test("duplicate opens the first owned snapshot",async({page,fakeFor,probe})=>{
  const fake=await fakeFor("standard");await open(page,fake,probe);let p=await point(page);await add(page,p);const first=(await stored(page)).captures[0];
  // Drawer size can change pixel placement; resolve the same captured time/price cell via table buttons.
  await page.locator("#ol-tab-cells").click();
  const row=page.locator(`#ol-table-body tr[data-c="${first.c}"][data-r="${first.r}"]`);
  if(await row.count()) {
    await row.getByRole("button",{name:"Add to comparison"}).click();
    expect((await stored(page)).captures).toEqual([first]);
  } else {
    // A known-zero cell is absent from the occupied-only table. Its chart menu still opens its original.
    await page.locator("#ol-drawer-toggle").click();p=await point(page);await menu(page,p);
    const existing=page.getByRole("menuitem",{name:"Open existing capture"});await expect(existing).toBeVisible();await existing.click();
  }
  await expect(page.locator("#ol-comparisonWorkspace")).toContainText("original values retained");
});

test("Cells Copy/Add preserve canonical numbers and row Enter still opens Inspect",async({page,fakeFor,probe})=>{
  const fake=await fakeFor("standard");await open(page,fake,probe);await page.locator("#ol-tab-cells").click();
  const row=page.locator("#ol-table-body tr").first();await expect(row).toBeVisible();
  const facts=await row.evaluate(n=>({c:+n.dataset.c,r:+n.dataset.r,volume:+n.querySelector('[data-field="volume"]').dataset.canonical,trades:+n.querySelector('[data-field="trades"]').dataset.canonical}));
  await row.getByRole("button",{name:"Add to comparison"}).click();await expect.poll(async()=> (await stored(page))?.captures.length).toBe(1);
  const c=(await stored(page)).captures[0];expect(c.c).toBe(facts.c);expect(c.r).toBe(facts.r);
  expect(c.metrics["volume.amount"].value).toBe(facts.volume);expect(c.metrics["trades.amount"].value).toBe(facts.trades);
  await page.locator("#ol-tab-cells").click();await row.focus();await page.keyboard.press("Enter");await expect(page.locator("#ol-inspect-detail")).toBeVisible();
  await expect(page.locator("#ol-inspect-detail-body").getByRole("button",{name:"Add to comparison"})).toBeVisible();
});

test("chart navigation does no comparison statistics or writes; Compare owns digit/Space/arrows",async({page,fakeFor,probe})=>{
  const fake=await fakeFor("standard");await open(page,fake,probe);await add(page,await point(page));
  const work=page.locator("#ol-comparisonWorkspace");
  const hash=await page.evaluate(()=>location.hash);await work.locator('[data-comparison-action="expand"]').focus();
  for(const key of ["1","ArrowLeft","Space"])await page.keyboard.press(key);
  expect(await page.evaluate(()=>location.hash)).toBe(hash);
  // Space activated native Expand; Escape restores without selection cleanup.
  await page.keyboard.press("Escape");await page.waitForTimeout(50);
  const before=await work.evaluate(n=>({stats:n.dataset.stats,writes:n.dataset.writes}));
  await page.locator("#ol-canvas").focus();await page.keyboard.press("ArrowLeft");await probe.waitForQuiet({quietMs:300});
  expect(await work.evaluate(n=>({stats:n.dataset.stats,writes:n.dataset.writes}))).toEqual(before);
});

test("reference/axis/candle surfaces retain non-cell context behavior",async({page,fakeFor,probe})=>{
  const fake=await fakeFor("standard");await open(page,fake,probe);const box=await page.locator("#ol-canvas").boundingBox();
  await page.mouse.click(box.x+8,box.y+20,{button:"right"});await expect(page.locator("#ol-cell-menu")).toHaveCount(0);
  await page.keyboard.press("m"); // chart mode cycle preserves collection availability; exact Candles choice below.
  await page.locator("#ol-mode").click();await page.locator('[data-mode="candles"]').click();await probe.waitForReady();
  await page.mouse.click((await point(page)).x,(await point(page)).y,{button:"right"});await expect(page.locator("#ol-cell-menu")).toHaveCount(0);
  await page.locator("#ol-tab-compare").click();await expect(page.locator("#ol-comparisonWorkspace")).toContainText("No captured cells");
});
