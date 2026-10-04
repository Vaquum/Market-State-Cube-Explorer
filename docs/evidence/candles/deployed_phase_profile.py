import concurrent.futures,json,math,sys,threading,time
sys.path.insert(0,"/app/tools")
import cube_bridge as b
native_query,native_table=b.query,b.read_table
trace=threading.local()
def query(*args,**kwargs):
 t=time.perf_counter()
 try:r=native_query(*args,**kwargs)
 except b.MarketStateError as error:
  trace.parts["attempts"].append({"ms":(time.perf_counter()-t)*1000,"status":error.status,"error":error.body.get("error")});raise
 trace.parts["attempts"].append({"ms":(time.perf_counter()-t)*1000,"status":200,"result_id":r.result_id});return r
def table(*args,**kwargs):
 t=time.perf_counter();r=native_table(*args,**kwargs);trace.parts["tables_ms"].append((time.perf_counter()-t)*1000);return r
initial,_,_=b.cube_query(t1=b.edge(3214000),t2=b.edge(3214001),tR=56.25,pR=125,p1=None,p2=None)
canon=math.floor(b.base_units(initial["canonical_through"]));a=(canon//256-3)*256
expected_read=b.read(4,0,a,a+16)[3];expected_bars=b.bar_read(8,a,a+256)[2]
b.query,b.read_table=query,table
def measured(kind,pair,load):
 trace.parts={"attempts":[],"tables_ms":[]};t=time.perf_counter()
 answer=b.read(4,0,a,a+16) if kind=="required" else b.bar_read(8,a,a+256)
 elapsed=(time.perf_counter()-t)*1000
 if answer[-1]!=(expected_read if kind=="required" else expected_bars):raise RuntimeError("Pinned source changed during diagnostics")
 rec={"diagnostic_only":True,"n":8,"kind":kind,"pair":pair,"concurrent":load,"total_ms":elapsed,**trace.parts}
 print(json.dumps(rec),flush=True);return rec
for pair in range(6):
 for load in ([False,True] if pair%2==0 else [True,False]):
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   other=pool.submit(measured,"candle",pair,True) if load else None
   measured("required",pair,load)
   if other:other.result()
