"use strict";
// P4-S1 independent source: exact BigInt trade calculator and hand-authored boundary vectors.
const {test}=require("node:test"), assert=require("node:assert/strict");
const {startFake}=require("../support/cube-fake.js"), {decodeBlock}=require("../support/wire.js");
const reference=require("../reference/bars.js"), fixture=require("../fixtures/trades/bars.json");
async function start(t){const fake=await startFake({profile:"micro:bars",port:0});t.after(()=>fake.close());return fake;}
async function bars(fake,n,b1){const {state_token}=fake.currentPack();const res=await fetch(`${fake.url}/cube/bars?proto=2&pack=${state_token}&n=${n}&b0=0&b1=${b1}`);return {res,body:await res.json()};}
test("all 21 route levels preserve MSCB OHLC and gaps against the independent calculator",async t=>{
 const fake=await start(t);
 for(let n=0;n<=20;n++){
  const {res,body}=await bars(fake,n,21);assert.equal(res.status,200,JSON.stringify(body));
  const block=decodeBlock(body.bars);const expected=reference.bars(fixture.trades,{n,b0:0,b1:21});
  assert.equal(body.bars.layout,"MSCB");assert.equal(block.count,expected.length);
  for(let i=0;i<expected.length;i++)for(const field of ["open","high","low","close"])assert.equal(block[field][i],expected[i][field],`${n}:${i}:${field}`);
 }
});
test("replay cutoff before, exactly at and after a trade timestamp excludes future trades",async t=>{
 const fake=await start(t);
 for(const ms of [999,1000,1001,224998,224999,225000,225001,799999,800000,800001]){
  const b1=ms/56250,{res,body}=await bars(fake,4,b1);assert.equal(res.status,200);
  const block=decodeBlock(body.bars),expected=reference.bars(fixture.trades,{n:4,b0:0,b1});
  assert.equal(block.count,expected.length,`edge ${ms}`);
  for(let i=0;i<expected.length;i++)for(const field of ["open","high","low","close"])assert.equal(block[field][i],expected[i][field],`edge ${ms}, ${field}`);
 }
});
test("outside levels, nonfinite endpoints, oversized reads and expired packs fail explicitly",async t=>{
 const fake=await start(t);
 for(const [n,b1] of [[21,21],[-1,21],[1.5,21],[0,4097],[0,"NaN"],[0,"Infinity"]])assert.equal((await bars(fake,n,b1)).res.status,400);
 const token=fake.currentPack().state_token;fake.expirePack(token);
 const res=await fetch(`${fake.url}/cube/bars?proto=2&pack=${token}&n=0&b0=0&b1=21`);assert.equal(res.status,409);
});
test("production Python handler validates candle bounds without loading a cube",()=>{
 const {spawnSync}=require("node:child_process");
 const script=`import sys,json\nsys.path.insert(0,'tools')\nimport cube_bridge as c\nclass Stub:\n def allows(self,x):return True\n def bars(self,n,a,b,token):return {'n':n,'b0':a,'b1':b}\nh=object.__new__(c.Handler);h.explorer=Stub();h.headers={};out=[]\nh.json=lambda body,status=200:out.append((status,body))\nfor n in range(21):\n h.path='/cube/bars?proto=2&n='+str(n)+'&b0=0&b1=0.125';h.do_GET();assert out[-1][0]==200 and out[-1][1]['b1']==0.125\nfor query in ['n=21&b0=0&b1=1','n=0&b0=0&b1=4097','n=2&b0=1&b1=4','n=0&b0=0&b1=NaN','n=0&b0=0&b1=Infinity']:\n h.path='/cube/bars?proto=2&'+query;h.do_GET();assert out[-1][0]==400,out[-1]\nprint(json.dumps({'passed':26}))\n`;
 const result=spawnSync("python3",["-c",script],{cwd:require("node:path").resolve(__dirname,"../.."),encoding:"utf8"});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{passed:26});
});
