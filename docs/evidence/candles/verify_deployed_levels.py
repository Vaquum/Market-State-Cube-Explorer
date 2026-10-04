import hashlib, importlib.util, json, math, sys
from datetime import UTC, datetime
from pathlib import Path
import numpy as np
sys.path.insert(0, '/app/tools')
import cube_bridge as baseline
spec = importlib.util.spec_from_file_location('candidate', '/tmp/candle_bridge.py')
candidate = importlib.util.module_from_spec(spec)
sys.modules['candidate'] = candidate
spec.loader.exec_module(candidate)
expected_bridge = 'c85c7b048a0dd9d810c798cdb6409f0adbe7e5c0c2e187e8f910043dd6f5eac7'
if hashlib.sha256(Path('/tmp/candle_bridge.py').read_bytes()).hexdigest() != expected_bridge:
    raise RuntimeError('Candidate bridge changed')
if baseline.CUBE_URL != candidate.CUBE_URL:
    raise RuntimeError('Explorer arms use different APIs')
initial, _, _ = candidate.cube_query(t1=candidate.edge(3214000), t2=candidate.edge(3214001), tR=56.25, pR=125, p1=None, p2=None)
canonical = math.floor(candidate.base_units(initial['canonical_through']))
print(json.dumps({'utc': datetime.now(UTC).isoformat(), 'api': candidate.CUBE_URL, 'canonical_through': initial['canonical_through'], 'data_cutoff': initial['data_cutoff'], 'candidate_bridge_sha256': expected_bridge}), flush=True)
for level in range(21):
    step = 2 ** level
    start = max(0, (canonical // step - 3) * step)
    response, bars, pins = candidate.bar_read(level, start, start + step)
    if not len(bars['col']) or not pins:
        raise RuntimeError(f'Missing traded support at n={level}')
    if not all(np.all(np.isfinite(bars[key])) for key in ('open', 'high', 'low', 'close')):
        raise RuntimeError(f'Non-finite OHLC at n={level}')
    if not np.all((bars['low'] <= bars['open']) & (bars['open'] <= bars['high']) & (bars['low'] <= bars['close']) & (bars['close'] <= bars['high'])):
        raise RuntimeError(f'Invalid OHLC ordering at n={level}')
    print(json.dumps({'level': level, 'start': start, 'end': start + step, 'records': len(bars['col']), 'pins': len(pins), 'valid_ohlc_order': True}), flush=True)
print(json.dumps({'pass': True, 'levels': 21, 'claim': 'Supported reader returns real occupied OHLC with valid ordering; not independent per-trade reconstruction'}), flush=True)
