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
 const formatted=E.codec.formatAddress({...read.view,appearance:"slate2-8f7890f7"},{CUT:1000,live:true});
 assert.equal(new URLSearchParams(formatted.hash.slice(1)).get("at"),"2021-01-01T00:01:40.001Z");
 assert.equal(E.codec.parseAddress(formatted.hash,{CUT:1000,live:true}).view.anchor,read.view.anchor);
});

test("portable views retain Candles and raw scale preferences without applying them to direction", async () => {
 const payload={visualVersion:2,kind:"view",query:{t1:0,t2:16,p1:199,p2:204,tR:2,pR:0},view:{mode:"candles",pane:"cells",auto:false,window:"",viewport:[0,16,199,204],anchor:100001/56250,replay:true,scale:{basis:"intensity",pathBasis:"usdt",transform:"rank",curve:"linear",rowsTransform:"value",cells:"explore",rows:"auto",local:true,window:null,lock:false}},appearance:{id:"slate2-8f7890f7"},scales:[],axes:[],models:[]};
 const encoded=await E.codec.encodePortable(payload), decoded=await E.codec.decodePortable(encoded.code ?? encoded);
 assert.equal(decoded.payload.view.mode,"candles");
 assert.equal(decoded.payload.view.anchor,payload.view.anchor);
 assert.deepEqual(decoded.payload.view.scale,payload.view.scale);
});

test("adjacent tail fills coalesce without losing complete candles or empty coverage", () => {
 const cache=new C.Cache(), make=(a,b,token)=>({n:0,a,b,end:b,generation:7,token,canon:null,bars:Array.from({length:b-a},(_,i)=>C.record({...raw,c:a+i},0,b))});
 cache.merge("initial",make(0,128,"0"),[]);
 for(let i=0;i<70;i++){
  const tail=make(128+i,129+i,String(i+1));
  cache.merge("tail"+i,tail,[...cache.ranges]);
 }
 assert.equal(cache.ranges.size,1);assert.equal(cache.records,198);
 const joined=[...cache.ranges.values()][0];assert.equal(joined.a,0);assert.equal(joined.b,198);
 assert.deepEqual(joined.bars.map(bar=>bar.c),Array.from({length:198},(_,i)=>i));
 cache.merge("empty",{...make(198,199,"71"),bars:[]},[...cache.ranges]);
 assert.equal(cache.ranges.size,1);assert.equal([...cache.ranges.values()][0].b,199);assert.equal(cache.records,198);
});
test("coalescing cannot bridge missing coverage or mix levels/generations; fresh overlap replaces a partial bar", () => {
 const cache=new C.Cache(), range=(a,b,end=b)=>({n:2,a,b,end,generation:1,token:"now",canon:null,bars:[]});
 cache.put("left",range(0,4));cache.put("hole",range(8,12));cache.put("other-level",{...range(4,8),n:1});cache.put("other-pack",{...range(4,8),generation:2});
 cache.merge("far",range(12,16),[...cache.ranges]);
 assert.equal(cache.ranges.size,4);assert.ok(cache.ranges.has("left"));assert.ok(cache.ranges.has("other-level"));assert.ok(cache.ranges.has("other-pack"));
 const partial={...range(16,18,18),bars:[C.record({...raw,c:4},2,18)]};
 cache.merge("partial",partial,[...cache.ranges]);
 const complete={...range(16,20),bars:[C.record({...raw,c:4,close:25032},2,20)]};
 cache.merge("complete",complete,[...cache.ranges]);
 const joined=[...cache.ranges.values()].find(r=>r.a===8);assert.equal(joined.b,20);assert.equal(joined.end,20);assert.equal(joined.bars[0].close,25032);assert.equal(joined.bars[0].state,"complete");
});
test("long histories split into bounded storage chunks and retain active main/lens windows under eviction", () => {
 const cache=new C.Cache(), keep=r=>r.n===2||(r.n===0&&(r.a===0||r.b===70*4096));
 cache.put("lens",{n:2,a:0,b:4,end:4,generation:1,bars:[C.record({...raw,c:0},2,4)]});
 cache.merge("history",{n:0,a:0,b:70*4096,end:70*4096,generation:1,bars:[]},[],keep);
 assert.equal(cache.ranges.size,64);assert.ok(cache.ranges.has("lens"));
 const main=[...cache.ranges.values()].filter(r=>r.n===0);
 assert.ok(main.some(r=>r.a===0));assert.ok(main.some(r=>r.b===70*4096));
 assert.ok(main.every(r=>r.b-r.a<=4096));assert.equal(cache.records,1);assert.equal(cache.bytes,192);
});
