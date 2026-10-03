import sys,json,math,time,base64,urllib.request,importlib.util,os
sys.path.insert(0,'/app/tools')
import cube_bridge as baseline
spec=importlib.util.spec_from_file_location('candidate','/tmp/candle_bridge.py');candidate=importlib.util.module_from_spec(spec);sys.modules['candidate']=candidate;spec.loader.exec_module(candidate)
response,_,_=candidate.cube_query(t1=candidate.edge(3214000),t2=candidate.edge(3214001),tR=56.25,pR=125,p1=None,p2=None)
pack={'cutoff':response['data_cutoff']}
cut=math.floor(candidate.base_units(pack['cutoff']));results=[]
print(json.dumps({'cutoff':pack['cutoff']}),flush=True)
for n in range(21):
 step=2**n;a=max(0,(cut//step-1)*step);b=min(cut,a+step);t=time.monotonic()
 try:
  response,bars,pins=candidate.bar_read(n,a,b)
  ok=all(float(bars['low'][i])<=min(float(bars['open'][i]),float(bars['close'][i]))<=max(float(bars['open'][i]),float(bars['close'][i]))<=float(bars['high'][i]) for i in range(len(bars['col'])))
  results.append({'n':n,'a':a,'b':b,'bars':len(bars['col']),'ohlc_order':ok,'seconds':round(time.monotonic()-t,4)})
 except Exception as e:results.append({'n':n,'error':str(e),'seconds':round(time.monotonic()-t,4)})
 print(json.dumps(results[-1]),flush=True)
print(json.dumps({'cutoff':pack['cutoff'],'required_levels':results,'all_pass':all('error' not in r and r['ohlc_order'] for r in results)}),flush=True)
