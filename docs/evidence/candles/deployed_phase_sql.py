import json,sys
from origo.assets.create_origo_database import get_clickhouse_settings,make_clickhouse_client
ids=json.load(sys.stdin);config=get_clickhouse_settings();client=make_clickhouse_client(config)
settings={"readonly":1,"max_execution_time":5,"max_memory_usage":536870912}
queries={
"receipts":"SELECT feed,series,minute,duration_ms,status,error_code FROM origo.worker_minute_log WHERE feed='market_state_api' AND minute >= now()-INTERVAL 10 MINUTE ORDER BY minute DESC LIMIT 10",
"log_schema":"DESCRIBE TABLE origo.container_log",
"phase_logs":"SELECT timestamp,service,message FROM origo.container_log WHERE timestamp >= now()-INTERVAL 15 MINUTE AND arrayExists(id -> position(message,id)>0,%(ids)s) ORDER BY timestamp LIMIT 100",
"sql_times":"SELECT log_comment,count(),sum(query_duration_ms),sum(read_rows),max(memory_usage),groupArray(tuple(query_duration_ms,substring(query,1,180))) FROM system.query_log WHERE event_time>=now()-INTERVAL 15 MINUTE AND type='QueryFinish' AND log_comment IN %(ids)s GROUP BY log_comment LIMIT 30"}
try:
 for label,query in queries.items():
  rows=client.execute(query,{"ids":ids},settings=settings)
  print(json.dumps({"kind":label,"rows":rows},default=str),flush=True)
finally:client.disconnect()
