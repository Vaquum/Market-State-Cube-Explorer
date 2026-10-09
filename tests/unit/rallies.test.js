"use strict";
// Oracle: recorded canonical Origo output; explicit exclusive boundary and immutable ID contracts.
const {test}=require("node:test"),assert=require("node:assert/strict"),{spawnSync}=require("node:child_process");
const api=require("../../src/rallies.js"),record=require("../fixtures/rallies/canonical.json");
test("retained rally definitions disclose the mode's normalized thresholds and anchor cadence",()=>{
  assert.equal(api.definitionText(record.discovery.metadata.normalized_definition),"First passage · target 30 bps · anchors every 1 min");
  // Presentation-only examples; no claim that these parameters produced the recorded events.
  assert.equal(api.definitionText({mode:"controlled_advance",scale:"bps",target:"60",anchor_minutes:5,pullback:"10"}),"Controlled advance · target 60 bps · anchors every 5 min · max pullback 10 bps");
  assert.equal(api.definitionText({mode:"swing",scale:"atr",target:"2",reversal:"0.5"}),"Swing · target 2 ATR14-SMA · confirming reversal 0.5 ATR14-SMA");
});
test("canonical rallies appear strictly after native confirmation, independent of grid",()=>{
  const first=record.events[0],edge=first.confirmed_at_us;
  assert.equal(api.visible(record.events,edge,null,false).length,0);
  assert.equal(api.visible(record.events,edge+1,null,false)[0].rally_id,first.rally_id);
  assert.equal(api.iso(edge),first.confirmed_at);
  assert.equal(api.visible(record.events,Date.parse(record.discovery.metadata.observation_ceiling)*1000,240,false).length,4);
  assert.equal(api.visible(record.events,edge+1,first.duration_seconds/60,false).length,0);
  assert.equal(api.visible(record.events,edge+1,1,true).length,1);
});
test("Python projection conserves native counters at every tested grid and refuses revised sources",()=>{
  const script=`import sys,json,math,datetime,threading,types
sys.path.insert(0,'tools')
import rally_bridge as r
from market_state_reader import MarketStateError
p=json.load(open('tests/fixtures/rallies/canonical.json'));meta=p['discovery']['metadata'];events=p['events'];members=p['members']
held={'state':{'data_cutoff':meta['data_cutoff']},'pins':{x[0]:x[1:] for x in meta['relevant_pins']}}
class E:
 def holding(self,token): return held
class Schema: metadata={r.META:json.dumps(meta).encode()}
class Batch:
 def __init__(self,rows):self.rows=rows;self.num_rows=len(rows)
 def to_pylist(self):return self.rows
 def column(self,key):return [row[key] for row in self.rows]
 def filter(self,mask):return Batch([row for row,yes in zip(self.rows,mask) if yes])
class Reader:
 schema=Schema();num_record_batches=1
 def get_batch(self,index):return Batch(members)
r.open_file=lambda *a,**kw:Reader()
pc=types.ModuleType('pyarrow.compute');pc.equal=lambda values,v:[x==v for x in values]
pa=types.ModuleType('pyarrow');pa.compute=pc;sys.modules['pyarrow']=pa;sys.modules['pyarrow.compute']=pc
store=r.RallyStore(E(),'unused',(threading.Lock(),threading.Lock()))
store.results['recorded']={'metadata':meta,'events':events,'result':types.SimpleNamespace(rally_cells='recorded'),'lock':threading.Lock(),'member_id':None,'members':[]}
event=events[0]
for n,m in [(0,0),(4,0),(12,3),(24,12)]:
 body={'pack':'held','result_id':'recorded','rally_id':event['rally_id'],'n':n,'m':m,'known_at':meta['observation_ceiling'],'deadline_minutes':240}
 answer=store.view(body)
 assert answer['selected']['rally_id']==event['rally_id']
 for key in r.FIELDS:
  got=math.fsum(c[key] for c in answer['cells'])
  assert math.isclose(got,event[key],rel_tol=1e-12),(key,got,event[key])
 assert sum(c['trade_count'] for c in answer['profile'])==event['trade_count']
 body['known_at']=event['confirmed_at'];answer=store.view(body);assert answer['selected'] is None and not answer['cells'] and answer['diagnostics'] is None
 body['known_at']=meta['observation_ceiling'];body['deadline_minutes']=event['duration_seconds']/60;answer=store.view(body);assert answer['selected'] is None
key=meta['relevant_pins'][0][0];held['pins'][key]=['revised','different']
try:store.view(body);raise AssertionError('revised source accepted')
except MarketStateError as e:assert e.status==409
assert r.wire({'confirmation_trade_id':2**64-1})['confirmation_trade_id']=='18446744073709551615'
print('conserved')
`;
  const result=spawnSync("python3",["-c",script],{cwd:require("node:path").resolve(__dirname,"../.."),encoding:"utf8"});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),"conserved");
});
test("rally POST boundary rejects malformed JSON, cross-origin requests and preserves native errors",()=>{
  const script=`import sys,io,json
sys.path.insert(0,'tools');import cube_bridge as c
from market_state_reader import MarketStateError
class R:
 def discover(self,body):raise MarketStateError(413,{'error':'native_row_limit','detail':'shorten the window'})
class E:rallies=R()
h=object.__new__(c.Handler);h.explorer=E();h.path='/cube/rallies?proto=2';out=[];h.json=lambda body,status=200:out.append((status,body))
def run(raw,origin=None):
 h.headers={'Content-Type':'application/json','Content-Length':str(len(raw)),'Host':'localhost'}
 if origin:h.headers['Origin']=origin
 h.rfile=io.BytesIO(raw.encode());h.do_POST();return out[-1]
assert run('{}')[0]==413
assert run('{"a":1,"a":2}')[0]==400
assert run('{"a":NaN}')[0]==400
assert run('{}','https://untrusted.example')[0]==403
h.path='/cube/rallies';assert run('{}')[0]==409
print('boundary')
`;
  const result=spawnSync("python3",["-c",script],{cwd:require("node:path").resolve(__dirname,"../.."),encoding:"utf8"});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),"boundary");
});
