"use strict";
// Independent mixed.json counters: columns 0..1, rows 200..202 total
// 602.25 USDT, 301.5 buy USDT, 9 trades, 4 buy trades. Ratios divide sums.
const { test, expect } = require("./fixtures.js");
const VIEW = "#t=2021-01-01T00:00Z~2021-01-01T00:06Z&p=24800~25500&r=0,0&auto=0&vis=2&marks=none&lines=";
const SEL = "&sel=2021-01-01T00:00Z~2021-01-01T00:01:52.500Z,25000~25375";
const CARD = "#ol-selection-card";
async function open(page, fakeFor, probe, suffix = SEL) {
  const fake = await fakeFor("micro:mixed"); await page.goto(fake.url + "/" + VIEW + suffix); await probe.waitForReady(); return fake;
}
const field = (page, key) => page.locator(`${CARD} .ol-cell-stat[data-measure="${({countShare:"flowtrades",dwellShare:"dwell"})[key] ?? key}"] dd`);
async function canonical(page, key, expected) { await expect.poll(async () => Number(await field(page, key).getAttribute("data-canonical"))).toBeCloseTo(expected, 10); }

test("area selection uses the cell sections and summed counters instead of mean cell ratios", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe);
  await expect(page.locator(CARD)).toHaveAttribute("data-presentation", "cell");
  await canonical(page, "volume", 602.25); await canonical(page, "trades", 9);
  await canonical(page, "delta", .75); await canonical(page, "imbalance", .75 / 602.25);
  await canonical(page, "size", 602.25 / 9); await canonical(page, "buySize", 301.5 / 4); await canonical(page, "sellSize", 300.75 / 5);
  await canonical(page, "countShare", 4 / 9);
  await expect(page.locator(`${CARD} .ol-flow-labels`)).toContainText("50.1%");
  expect(await page.locator(`${CARD} h3`).allTextContents()).toEqual(["Activity", "Aggression", "Reported trade size", "Location", "Selection profile"]);
  await expect(page.locator(`${CARD} .ol-card-profile`)).toBeVisible();
  await page.locator("#ol-clear").click(); await expect(page.locator(CARD)).toHaveCount(0);
  await expect(page.locator("#ol-vol")).toBeVisible(); await expect(page.locator("#ol-vol")).toHaveAttribute("data-canonical", "953.375");
});

test("one-cell selection and Cell share canonical composition and section styling", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe, "&sel=2021-01-01T00:00Z~2021-01-01T00:00:56.250Z,25000~25125");
  await canonical(page, "size", 150); await canonical(page, "imbalance", -1 / 3);
  const canvas = page.locator("#ol-canvas"), box = await canvas.boundingBox(), layout = (await canvas.getAttribute("data-layout")).split(",").map(Number);
  await page.mouse.move(box.x + layout[0] + layout[2] * 28.125 / 360, box.y + layout[1] + layout[3] * (25500 - 25062.5) / 700);
  await page.keyboard.press("e"); await page.getByRole("tab", { name: "Cells", exact: true }).click();
  for (const key of ["size", "imbalance", "buySize", "sellSize"]) {
    await expect(page.locator(`#ol-inspect-readout dd[data-field="${key}"]`)).toHaveAttribute("data-canonical", await field(page, key).getAttribute("data-canonical"));
    const sizes = await page.locator(`#ol-inspect-readout dd[data-field="${key}"], ${CARD} dd[data-field="${key}"]`).evaluateAll(ns => ns.map(n => getComputedStyle(n).fontSize));
    expect(new Set(sizes).size).toBe(1);
  }
});

test("selection histories compare equal-duration windows in the same band and retain zero versus missing support", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe, "&sel=2021-01-01T00:01:52.500Z~2021-01-01T00:03:45Z,25000~25375");
  const record = await page.locator(CARD).evaluate(n => JSON.parse(n.dataset.observation));
  expect(record.time).toEqual([2, 4]); expect(record.price).toEqual([25000, 25375]);
  expect(record.history.slice(-2).map(x => x.time)).toEqual([[0, 2], [2, 4]]);
  const histories = await page.locator(CARD).evaluate(n => JSON.parse(n.dataset.compactHistories));
  expect(histories.find(h => h.id === "volume").slots.slice(-2).map(x => x.result)).toEqual([{ tag: "finite", value: 602.25 }, { tag: "finite", value: 0 }]);
  expect(histories.find(h => h.id === "imbalance").slots.at(-1).result).toEqual({ tag: "undefined", denominator: "cell volume" });
  expect(histories[0].slots[0].result.tag).toBe("unsupported");
  await expect(page.locator(CARD)).toContainText("No trades in this selection");
});

test("selection movement uses its own covered seconds and measured price width", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe, SEL + "&mode=path");
  // Hand fixture: path 250 + 125 + 125 = 500 USDT; dwell 41.25 + 10 + 3.75 + 40 + 12.5 = 107.5 s.
  await expect(page.locator(`${CARD} [data-group="movement"]`)).toBeVisible();
  await canonical(page, "dwellShare", 107.5 / 112.5);
  const record = await page.locator(CARD).evaluate(n => JSON.parse(n.dataset.observation));
  expect(record.time).toEqual([0, 2]); expect(record.result.value).toBeCloseTo(500 / 375, 12);
});

for (const theme of ["light", "dark"]) test(`${theme}: narrow selection preserves readable groups and disclosure focus`, async ({ page, fakeFor, probe, allowConsole }) => {
  await page.emulateMedia({ colorScheme: theme }); await page.setViewportSize({ width: 960, height: 700 });
  const fake = await open(page, fakeFor, probe);
  // Superseding the pack deliberately conflicts with in-flight context reads.
  // Allow only that expected 409, following the revision-recovery contract.
  fake.on({ route: /^\/cube\/(query|tile|columns|bars|touched)/ }).delay(0);
  allowConsole(/Failed to load resource.*409/);
  const summary = page.locator(`${CARD} .ol-cell-details > summary`); await summary.click();
  await expect(summary).toBeFocused();
  fake.revise({ day: "2021-01-01", factor: 2 });
  await expect.poll(async () => Number(await field(page, "volume").getAttribute("data-canonical"))).toBe(1204.5);
  await expect(page.locator(`${CARD} .ol-cell-details`)).toHaveAttribute("open", ""); await expect(summary).toBeFocused();
  // Context reads can replace a resolved node; reacquire the live row.
  await expect.poll(() => field(page, "size").evaluate(n => n.isConnected && parseFloat(getComputedStyle(n).fontSize) >= 18 && n.getBoundingClientRect().width > 0)).toBe(true);
  await page.screenshot({ path: `reports/selection-card-${theme}.png` });
});

test("Select drag displays the shared area card and Escape restores the view", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe, "");
  const canvas = page.locator("#ol-canvas"), box = await canvas.boundingBox(), l = (await canvas.getAttribute("data-layout")).split(",").map(Number);
  const xy = (t,p) => [box.x + l[0] + l[2]*t/360, box.y+l[1]+l[3]*(25500-p)/700];
  await canvas.focus(); await page.keyboard.press("s");
  await page.mouse.move(...xy(1,25375)); await page.mouse.down();
  await page.mouse.move(...xy(112.5,25000), {steps:5}); await page.mouse.up();
  await canonical(page,"volume",602.25); await canonical(page,"size",602.25/9);
  await expect(page.locator(CARD)).toHaveAttribute("data-presentation","cell");
  await canvas.focus(); await page.keyboard.press("Escape"); await expect(page.locator(CARD)).toHaveCount(0);
  await expect(page.locator("#ol-vol")).toBeVisible();
});

test("replay clips selection values and histories to their actual support", async ({page,fakeFor,probe}) => {
  await open(page,fakeFor,probe);
  await canonical(page,"volume",602.25);
  await page.evaluate(hash => {location.hash=hash;}, VIEW+SEL+"&replay=1&at=2021-01-01T00:00:56.250Z");
  await canonical(page,"volume",350.25); await canonical(page,"size",350.25/5);
  const record=await page.locator(CARD).evaluate(n=>JSON.parse(n.dataset.observation));
  expect(record.time).toEqual([0,1]); expect(record.history.at(-1).time).toEqual([0,1]);
  expect(record.result.value).toBe(350.25);
});

for (const state of ["pending","failed"]) test(`${state}: area card refuses fabricated counters and profile`, async ({page,fakeFor,allowConsole}) => {
  if(state==="failed") allowConsole(/Failed to load resource/);
  const fake=await fakeFor("standard",{next:300}), rule=fake.on({route:"/cube/query",when:q=>"r0" in q});
  const gate=state==="pending"?rule.gate():null;
  if(state==="failed") rule.fail({status:503,body:{error:"selection measurement rejected"}});
  try {
    await page.goto(`${fake.url}/#t=2026-09-16T12:07Z~2026-09-25T05:00Z&p=15000~45000&sel=2026-09-16T12:07Z~2026-09-25T05:00Z,15000~45000`);
    if(gate) await gate.arrived();
    await expect(field(page,"volume")).toHaveAttribute("data-canonical",state);
    await expect(field(page,"size")).toHaveAttribute("data-canonical",state);
    await expect(page.locator(`${CARD} [data-group="selection-profile"] svg`)).toHaveCount(0);
    await expect(page.locator(`${CARD} [data-group="selection-profile"]`)).toContainText(state==="pending"?/Measuring|Reading/:"selection measurement rejected");
    await expect(page.locator(CARD)).not.toContainText("No trades in this selection");
  } finally {gate?.open();}
});

test("a selection after the replay edge retains an unsupported card without interrupting draw", async ({page,fakeFor,probe}) => {
  await open(page,fakeFor,probe,"&sel=2021-01-01T00:01:52.500Z~2021-01-01T00:03:45Z,25000~25375");
  await page.evaluate(hash=>{location.hash=hash;}, VIEW+"&sel=2021-01-01T00:01:52.500Z~2021-01-01T00:03:45Z,25000~25375&replay=1&at=2021-01-01T00:00:56.250Z");
  await expect(field(page,"volume")).toHaveAttribute("data-canonical","unsupported");
  await expect(page.locator(`${CARD} .ol-cell-details > summary`)).toBeVisible();
  await expect(page.locator(CARD)).toContainText("No measured support inside this selection");
});

for (const state of ["pending","failed"]) test(`${state}: missing motion still renders area activity and details`, async ({page,fakeFor,allowConsole}) => {
  if(state==="failed") allowConsole(/Failed to load resource/);
  const fake=await fakeFor("micro:mixed");
  const rules=[fake.on({route:"/cube/motion"}),fake.on({route:"/cube/query",when:q=>q.motion==="1"})];
  const gates=state==="pending"?rules.map(r=>r.gate()):[];
  if(state==="failed") for(const r of rules) r.fail({status:503,body:{error:"selection motion rejected"}});
  try {
    await page.goto(fake.url+"/"+VIEW+SEL+"&mode=path");
    await expect(field(page,"volume")).toHaveAttribute("data-canonical","602.25");
    await expect(page.locator(`${CARD} .ol-cell-details > summary`)).toBeVisible();
    await expect(field(page,"path")).toHaveAttribute("data-canonical",state);
    if(state==="failed") await expect(page.locator(CARD)).toContainText("selection motion rejected");
  } finally {for(const g of gates) g.open();}
});
