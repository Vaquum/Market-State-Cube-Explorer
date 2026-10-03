"use strict";
// P4-S1 oracle: hand-calculated OHLC geometry, palette literals and documented menu/shortcut contract.
const {test,expect}=require("./fixtures.js");
const place=url=>[...new URLSearchParams(new URL(url).hash.slice(1))].filter(([k])=>["t","p","r","w","sel","at","rows","pane","period","lines"].includes(k));
test("Candles replaces cells and K restores the prior mode without moving the camera",async({page,fakeFor})=>{
 const fake=await fakeFor("mini");await page.goto(fake.url+"/#t=2026-09-23T12:00Z~2026-09-24T12:00Z&p=24600~25400&r=4,0&mode=delta");await expect(page.locator("#ol-mode-text")).toHaveText("Delta");const before=place(page.url());
 await page.keyboard.press("k");await expect(page.locator("#ol-mode-text")).toHaveText("Candles");await expect(page.locator("#ol-candle-legend")).toHaveAttribute("data-state","ready");expect(place(page.url())).toEqual(before);
 await page.keyboard.down("k");await page.keyboard.down("k");await page.keyboard.up("k");await expect(page.locator("#ol-mode-text")).toHaveText("Delta");expect(place(page.url())).toEqual(before);
 await page.locator("#ol-mode").click();await page.locator('[data-mode="candles"]').click();await expect(page.locator("#ol-mode-text")).toHaveText("Candles");
 await page.locator("#ol-mode").click();await expect(page.locator("#ol-mode-menu")).not.toContainText("Local contrast");await page.keyboard.press("Escape");await page.keyboard.press("m");await expect(page.locator("#ol-mode-text")).toHaveText("Volume");await page.keyboard.press("Shift+m");await expect(page.locator("#ol-mode-text")).toHaveText("Candles");
});
test("exact OHLC table and Inspect read the same candle, including live partial coverage",async({page,fakeFor})=>{
 const fake=await fakeFor("micro:bars");await page.goto(fake.url+"/#t=2021-01-01T00:00Z~2021-01-01T00:20Z&p=24800~25400&r=2,0&mode=candles");await expect(page.locator("#ol-candle-legend")).toHaveAttribute("data-state","ready");
 await page.keyboard.press("t");const rows=page.locator("#ol-candle-table tbody tr");await expect(rows).toHaveCount(4);await expect(rows.first()).toContainText("25,000");await expect(rows.first()).toContainText("25,375");await expect(rows.last()).toContainText("So far");
 await rows.first().focus();await expect(page.locator("#ol-inspect-readout")).toContainText("Open");await expect(page.locator("#ol-tip")).toHaveAttribute("data-open","25000");await expect(page.locator("#ol-tip")).toHaveAttribute("data-low","24875");
});
for(const theme of ["light","dark"])test(`candle raster ${theme}: hollow up, filled down, neutral doji; no row snapping`,async({page,fakeFor},info)=>{
 const fake=await fakeFor("mini");await page.emulateMedia({colorScheme:theme});await page.goto(fake.url+"/#w=24h&mode=candles");await expect(page.locator("#ol-candle-legend")).toHaveAttribute("data-state","ready");
 const pixels=await page.evaluate(theme=>{
  const C=window.explorerEncoding.candles,cv=document.createElement("canvas");cv.width=90;cv.height=70;const ctx=cv.getContext("2d");
  const inks=theme==="light"?{positive:"#2d769c",negative:"#b3624b",midpoint:"#b9c2bc",state:"#5c7263",surface:"#ffffff"}:{positive:"#73b8d4",negative:"#d89777",midpoint:"#5f6b64",state:"#a1b5a7",surface:"#161f19"};ctx.fillStyle=inks.surface;ctx.fillRect(0,0,90,70);
  for(const [c,open,close] of [[0,1.25,3.75],[1,3.75,1.25],[2,2.25,2.25]])C.paint(ctx,C.record({c,open,close,high:5.25,low:.25},0,3),t=>t*30,p=>60-p*10,1,inks);
  const at=(x,y)=>Array.from(ctx.getImageData(x,y,1,1).data).slice(0,3);return {up:at(15,35),down:at(45,35),doji:at(75,37),wick:at(15,10)};
 },theme);
 expect(pixels.up).toEqual(theme==="light"?[255,255,255]:[22,31,25]);expect(pixels.down).toEqual(theme==="light"?[179,98,75]:[216,151,119]);expect(pixels.wick).not.toEqual(pixels.up);expect(pixels.doji).not.toEqual(pixels.up);
 await page.screenshot({path:info.outputPath(`candles-${theme}.png`)});
});
