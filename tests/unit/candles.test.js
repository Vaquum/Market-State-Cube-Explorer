"use strict";
// P4-S1 oracle: prices and screen coordinates calculated by hand; no grid/renderer-derived expectations.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc.js");
const C = E.candles;
const raw = { c: 3, open: 25001.25, high: 25083.75, low: 24996.5, close: 25031.5 };
test("OHLC is exact, immutable and labelled by close minus open; partial coverage is explicit", () => {
  const bar = C.record(raw, 2, 14.5);
  assert.equal(bar.start, 12); assert.equal(bar.stop, 16); assert.equal(bar.through, 14.5);
  assert.equal(bar.direction, "up"); assert.equal(bar.state, "so-far");
  assert.equal(bar.low, 24996.5); assert.ok(Object.isFrozen(bar));
  assert.equal(C.record({...raw, close:raw.open},2,16).direction,"unchanged");
  assert.equal(C.record({...raw, close:25000},2,16).direction,"down");
  for (const bad of [{...raw, low:25002}, {...raw, high:25002}, {...raw, open:NaN}, {...raw,c:-1}]) assert.throws(()=>C.record(bad,2,16));
  assert.throws(()=>C.record(raw,21,16)); assert.throws(()=>C.record(raw,2,12));
});
test("fractional prices project continuously and do not snap to 125-USDT rows", () => {
  const bar = C.record(raw,2,16);
  const g = C.project(bar,t=>t*10,p=>3000-p*10,125);
  assert.equal(g.x,140); assert.equal(g.width,26);
  assert.equal(g.top,3000-25031.5/125*10); assert.equal(g.bottom,3000-25001.25/125*10);
  assert.equal(g.high,3000-25083.75/125*10); assert.equal(g.low,3000-24996.5/125*10);
  assert.equal(g.wickOnly,false);
  assert.equal(C.project(bar,t=>t*.5,p=>p,125).wickOnly,true);
  // An equivalent transform using another unit gives the same screen coordinates.
  const equivalent=C.project(bar,t=>t*10,p=>3000-p,12.5);
  for (const field of ["x","width","top","bottom","high","low"]) assert.ok(Math.abs(equivalent[field]-g[field])<1e-9);
});
function context() {
  const calls=[];
  const ctx={calls,setLineDash(){},beginPath(){},moveTo(x,y){calls.push(["move",x,y]);},lineTo(x,y){calls.push(["line",x,y]);},stroke(){calls.push(["stroke",this.strokeStyle,this.lineWidth]);},fillRect(...p){calls.push(["fill",this.fillStyle,...p]);},strokeRect(...p){calls.push(["body",this.strokeStyle,...p]);}};
  return ctx;
}
test("direction uses the signed arms, hollow up and filled down; doji has a neutral casing", () => {
  const inks={positive:"blue",negative:"clay",midpoint:"mid",state:"neutral",surface:"paper"};
  for (const [close,color,fill] of [[25031.5,"blue","paper"],[25000,"clay","clay"]]) {
    const ctx=context(); C.paint(ctx,C.record({...raw,close},2,16),t=>t*10,p=>-p*125,125,inks);
    assert.ok(ctx.calls.some(x=>x[0]==="stroke"&&x[1]===color&&x[2]===1));
    assert.ok(ctx.calls.some(x=>x[0]==="fill"&&x[1]===fill));
  }
  const ctx=context(); C.paint(ctx,C.record({...raw,close:raw.open},2,16),t=>t*10,p=>-p,125,inks);
  assert.ok(ctx.calls.some(x=>x[0]==="stroke"&&x[1]==="neutral"&&x[2]===3));
  assert.ok(ctx.calls.some(x=>x[0]==="stroke"&&x[1]==="mid"&&x[2]===1));
});
test("dense candles collapse to a wick; one-price bars retain a horizontal stroke", () => {
  const ctx=context(), inks={positive:"blue",negative:"clay",midpoint:"mid",state:"neutral",surface:"paper"};
  C.paint(ctx,C.record(raw,2,16),t=>t*.5,p=>-p,125,inks);
  assert.equal(ctx.calls.some(x=>x[0]==="fill"||x[0]==="body"),false);
  const flat=context(); C.paint(flat,C.record({c:0,open:7,high:7,low:7,close:7},0,1),t=>t*.5,p=>p,1,inks);
  assert.ok(flat.calls.some(x=>x[0]==="line"&&x[1]!==.25));
});
test("visible range buffer is aligned and cutoff bounded; LRU enforces numeric budgets", () => {
  assert.deepEqual(C.span(2,13,27,25),{n:2,a:8,b:25});
  const cache=new C.Cache();
  for(let i=0;i<64;i++)cache.put(i,{bars:[raw]});
  cache.touch(0);cache.put(64,{bars:[raw]});
  assert.equal(cache.ranges.has(0),true);assert.equal(cache.ranges.has(1),false);
  assert.equal(cache.records,64);assert.equal(cache.bytes,64*192);
  cache.clear();
  for(let i=0;i<17;i++)cache.put(i,{bars:Array(4096).fill(raw)});
  assert.equal(cache.records,65536); assert.equal(cache.ranges.size,16);
  assert.ok(cache.bytes<=16777216);assert.throws(()=>cache.put("huge",{bars:Array(65537).fill(raw)}));
});
test("Candles addresses preserve fractional replay anchors", async () => {
 const address="#w=24h&mode=candles&replay=1&at=2021-01-01T00:01:40.001Z";
 const read=E.codec.parseAddress(address,{CUT:1000,live:true});
 assert.equal(read.view.mode,"candles");assert.ok(Math.abs(read.view.anchor-100001/56250)<1e-9);
 const formatted=E.codec.formatAddress({...read.view,appearance:"slate2-8f7890f7"},{CUT:1000,live:true});assert.ok(formatted.hash.includes("00%3A01")||formatted.hash.includes("00:01:40.001"),formatted.hash);
});

test("portable views retain Candles and raw scale preferences without applying them to direction", async () => {
 const payload={visualVersion:2,kind:"view",query:{t1:0,t2:16,p1:199,p2:204,tR:2,pR:0},view:{mode:"candles",pane:"cells",auto:false,window:"",viewport:[0,16,199,204],anchor:100001/56250,replay:true,scale:{basis:"intensity",pathBasis:"usdt",transform:"rank",curve:"linear",rowsTransform:"value",cells:"explore",rows:"auto",local:true,window:null,lock:false}},appearance:{id:"slate2-8f7890f7"},scales:[],axes:[],models:[]};
 const encoded=await E.codec.encodePortable(payload), decoded=await E.codec.decodePortable(encoded.code ?? encoded);
 assert.equal(decoded.payload.view.mode,"candles");
 assert.equal(decoded.payload.view.anchor,payload.view.anchor);
 assert.deepEqual(decoded.payload.view.scale,payload.view.scale);
});
