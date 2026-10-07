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
    // Inspect starts context reads; capture a settled profile so the stale-menu guard remains meaningful.
    await probe.waitForReady();await probe.waitForQuiet({quietMs:300,timeout:60000});
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
    await page.locator("#ol-canvas").press("t");p=await point(page);await menu(page,p);
    const existing=page.getByRole("menuitem",{name:"Open existing capture"});await expect(existing).toBeVisible();await existing.click();
  }
  await expect(page.locator("#ol-comparisonWorkspace")).toContainText("original values retained");
});

test("Cells Copy/Add preserve canonical numbers and row Enter still opens Inspect",async({page,fakeFor,probe})=>{
  const fake=await fakeFor("standard");await open(page,fake,probe);await page.locator("#ol-tab-cells").click();await fake.idle({quietMs:300,timeoutMs:30000});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const row=page.locator("#ol-table-body tr").first();await expect(row).toBeVisible();
  const facts=await row.evaluate(n=>({c:+n.dataset.c,r:+n.dataset.r,volume:+n.querySelector('[data-field="volume"]').dataset.canonical,trades:+n.querySelector('[data-field="trades"]').dataset.canonical}));
  const hash=await page.evaluate(()=>location.hash);
  await page.evaluate(()=>Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async(text)=>{window.__cellCopy=text;}}}));
  await row.getByRole("button",{name:"Copy cell"}).focus();await page.keyboard.press("Enter");
  await expect.poll(()=>page.evaluate(()=>window.__cellCopy)).toContain("Volume: "+facts.volume+" usdt");
  expect((await stored(page))?.captures.length??0).toBe(0);
  await row.getByRole("button",{name:"Add to comparison"}).focus();
  for(const key of ["1","ArrowLeft"])await page.keyboard.press(key);
  expect(await page.evaluate(()=>location.hash)).toBe(hash);
  await page.keyboard.press("Space");await expect.poll(async()=> (await stored(page))?.captures.length).toBe(1);
  const c=(await stored(page)).captures[0];expect(c.c).toBe(facts.c);expect(c.r).toBe(facts.r);
  expect(c.metrics["volume.amount"].value).toBe(facts.volume);expect(c.metrics["trades.amount"].value).toBe(facts.trades);
  await page.locator("#ol-tab-cells").click();await row.focus();await page.keyboard.press("Enter");await expect(page.locator("#ol-inspect-detail")).toBeVisible();
  await expect(page.locator("#ol-inspect-detail-body").getByRole("button",{name:"Add to comparison"})).toBeVisible();
});

test("Cells Add keeps native Space activation across a table refresh",async({page,fakeFor,probe})=>{
  const fake=await fakeFor("standard");await open(page,fake,probe);
  await page.locator("#ol-tab-cells").click();await fake.idle({quietMs:300,timeoutMs:30000});
  const button=page.locator("#ol-table-body tr").first().getByRole("button",{name:"Add to comparison"});
  await button.focus();await page.keyboard.down("Space");
  await page.evaluate(()=>{window.__heldCellButton=document.activeElement;});
  await page.setViewportSize({width:1499,height:950});
  await page.waitForTimeout(200); // Deliberately span the 80 ms table rebuild while Space is held.
  expect(await page.evaluate(()=>window.__heldCellButton.isConnected),"the native activation target stays attached until keyup").toBe(true);
  await page.keyboard.up("Space");
  await expect.poll(async()=> (await stored(page))?.captures.length).toBe(1);
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


test("uncaptured Copy fallback clears on a rewind within replay without statistics or storage work",async({page,fakeFor,probe})=>{
  const fake=await fakeFor("standard"),hash="#t=2026-09-23T12:00Z~2026-09-24T12:00Z&p=24600~25400&r=4,0&vis=2&marks=none&lines=&poc=0&replay=1&at=2026-09-24T06:00Z";
  await page.goto(fake.url+"/"+hash);await atRest(page,fake,probe);await probe.waitForQuiet({quietMs:300});
  await page.evaluate(()=>Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async()=>{throw Error("denied");}}}));
  await menu(page,await point(page));await page.getByRole("menuitem",{name:"Copy cell"}).click();
  const work=page.locator("#ol-comparisonWorkspace"),box=work.locator(".ol-comparison-copy"),text=box.locator("textarea");
  await expect(box).toBeVisible();await expect(text).toHaveValue(/Volume: [0-9]/);
  expect((await stored(page))?.captures.length??0).toBe(0);
  const before=await work.evaluate(n=>({stats:n.dataset.stats,writes:n.dataset.writes}));
  await page.evaluate(next=>{location.hash=next;},hash.replace("at=2026-09-24T06:00Z","at=2026-09-23T12:00Z"));
  await expect(page.locator("#ol-replay-at")).toHaveText("23 Sep 12:00");
  await expect(box).toBeHidden();await expect(text).toHaveValue("");
  expect(await work.evaluate(n=>({stats:n.dataset.stats,writes:n.dataset.writes}))).toEqual(before);
});

for(const tool of ["pan","trend"])
  test(`Control pressed after ${tool} drag start still completes its primary release`,async({page,fakeFor,probe})=>{
    const fake=await fakeFor("standard");await open(page,fake,probe);await page.locator(`[data-tool="${tool}"]`).click();
    const a=await point(page),b={x:a.x+90,y:a.y-45};
    await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:6});
    await page.keyboard.down("Control");await page.mouse.up();await page.keyboard.up("Control");
    await expect(page.locator("#ol-cell-menu")).toHaveCount(0);
    await probe.waitForQuiet({quietMs:300});
    if(tool==="trend") {
      await expect(page.locator("#ol-canvas")).toHaveAttribute("data-drawing-count","1");
      await expect(page.locator('[data-tool="trend"]')).toHaveAttribute("aria-pressed","true");
    }
    const after=await page.evaluate(()=>location.hash);
    await page.mouse.move(b.x+60,b.y+30);await probe.waitForQuiet({quietMs:300});
    expect(await page.evaluate(()=>location.hash)).toBe(after);
  });

for(const boundary of ["canvas","viewport"])
  for(const tool of ["pan","trend"])
    test(`Control-start release outside ${boundary} does not consume the next ${tool} drag`,async({page,fakeFor,probe})=>{
      const fake=await fakeFor("standard");await open(page,fake,probe);await page.locator(`[data-tool="${tool}"]`).click();
      const a=await point(page),box=await page.locator("#ol-canvas").boundingBox(),before=await page.evaluate(()=>location.hash);
      await page.evaluate(()=>{window.__outsideMenuRelease=false;document.addEventListener("pointerup",event=>{window.__outsideMenuRelease=event.isTrusted&&event.target!==document.getElementById("ol-canvas");},{once:true});});
      await page.mouse.move(a.x,a.y);await page.keyboard.down("Control");await page.mouse.down();
      await expect(page.locator("#ol-cell-menu")).toBeVisible();
      const outside=boundary==="canvas"?{x:box.x+box.width-30,y:box.y-12}:{x:-20,y:-20};
      await page.mouse.move(outside.x,outside.y,{steps:4});await page.mouse.up();await page.keyboard.up("Control");
      if(boundary==="canvas")expect(await page.evaluate(()=>window.__outsideMenuRelease)).toBe(true);
      await page.keyboard.press("Escape");await expect(page.locator("#ol-cell-menu")).toHaveCount(0);
      expect(await page.evaluate(()=>location.hash)).toBe(before);
      const start=await point(page),end={x:start.x+90,y:start.y-45};
      await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:6});await page.mouse.up();
      await probe.waitForQuiet({quietMs:300});
      if(tool==="trend") {
        await expect(page.locator("#ol-canvas")).toHaveAttribute("data-drawing-count","1");
        await expect(page.locator('[data-tool="trend"]')).toHaveAttribute("aria-pressed","true");
      } else expect(await page.evaluate(()=>location.hash)).not.toBe(before);
      const after=await page.evaluate(()=>location.hash);
      await page.mouse.move(end.x+60,end.y+30);await probe.waitForQuiet({quietMs:300});
      expect(await page.evaluate(()=>location.hash)).toBe(after);
      expect((await stored(page))?.captures.length??0).toBe(0);
    });

for(const tool of ["pan","trend"])
  test(`primary ${tool} drag completes when the secondary button is released last`,async({page,fakeFor,probe})=>{
    const fake=await fakeFor("standard");await open(page,fake,probe);await page.locator(`[data-tool="${tool}"]`).click();
    const a=await point(page),b={x:a.x+90,y:a.y-45},before=await page.evaluate(()=>location.hash);
    await page.evaluate(()=>{window.__chordReleases=[];document.addEventListener("pointerup",event=>{if(event.target===document.getElementById("ol-canvas"))window.__chordReleases.push({button:event.button,buttons:event.buttons,trusted:event.isTrusted});},true);});
    await page.mouse.move(a.x,a.y);await page.mouse.down({button:"left"});await page.mouse.move(b.x,b.y,{steps:6});
    await page.mouse.down({button:"right"});await page.mouse.up({button:"left"});await page.mouse.up({button:"right"});
    expect(await page.evaluate(()=>window.__chordReleases)).toEqual([{button:2,buttons:0,trusted:true}]);
    if(await page.locator("#ol-cell-menu").count())await page.keyboard.press("Escape");
    await probe.waitForQuiet({quietMs:300});
    if(tool==="trend") {
      await expect(page.locator("#ol-canvas")).toHaveAttribute("data-drawing-count","1");
      await expect(page.locator('[data-tool="trend"]')).toHaveAttribute("aria-pressed","true");
    } else expect(await page.evaluate(()=>location.hash)).not.toBe(before);
    const after=await page.evaluate(()=>location.hash);
    await page.mouse.move(b.x+60,b.y+30);await probe.waitForQuiet({quietMs:300});
    expect(await page.evaluate(()=>location.hash)).toBe(after);
    expect((await stored(page))?.captures.length??0).toBe(0);
  });

for(const tool of ["pan","trend"])
  test(`secondary-first ${tool} chord does not consume the next primary gesture release`,async({page,fakeFor,probe})=>{
    const fake=await fakeFor("standard");await open(page,fake,probe);await page.locator(`[data-tool="${tool}"]`).click();
    const a=await point(page),b={x:a.x+90,y:a.y-45},before=await page.evaluate(()=>location.hash);
    // Capture above the menu's document listener to verify both real terminal releases, even when it owns one.
    await page.evaluate(()=>{window.__chordReleases=[];window.addEventListener("pointerup",event=>{if(event.target===document.getElementById("ol-canvas"))window.__chordReleases.push({button:event.button,buttons:event.buttons,trusted:event.isTrusted});},true);});
    await page.mouse.move(a.x,a.y);await page.mouse.down({button:"right"});
    await expect(page.locator("#ol-cell-menu")).toBeVisible();await page.keyboard.press("Escape");
    await expect(page.locator("#ol-cell-menu")).toHaveCount(0);
    await page.mouse.down({button:"left"});await page.mouse.up({button:"right"});await page.mouse.up({button:"left"});
    expect(await page.evaluate(()=>window.__chordReleases)).toEqual([{button:0,buttons:0,trusted:true}]);
    await probe.waitForQuiet({quietMs:300});
    expect(await page.evaluate(()=>location.hash)).toBe(before);
    await expect(page.locator("#ol-canvas")).toHaveAttribute("data-drawing-count","0");
    await page.mouse.move(a.x,a.y);await page.mouse.down({button:"left"});await page.mouse.move(b.x,b.y,{steps:6});
    await page.mouse.down({button:"right"});await page.mouse.up({button:"left"});await page.mouse.up({button:"right"});
    expect(await page.evaluate(()=>window.__chordReleases)).toEqual([{button:0,buttons:0,trusted:true},{button:2,buttons:0,trusted:true}]);
    if(await page.locator("#ol-cell-menu").count())await page.keyboard.press("Escape");
    await probe.waitForQuiet({quietMs:300});
    if(tool==="trend") {
      await expect(page.locator("#ol-canvas")).toHaveAttribute("data-drawing-count","1");
      await expect(page.locator('[data-tool="trend"]')).toHaveAttribute("aria-pressed","true");
    } else expect(await page.evaluate(()=>location.hash)).not.toBe(before);
    const after=await page.evaluate(()=>location.hash);
    await page.mouse.move(b.x+60,b.y+30);await probe.waitForQuiet({quietMs:300});
    expect(await page.evaluate(()=>location.hash)).toBe(after);
    expect((await stored(page))?.captures.length??0).toBe(0);
  });
