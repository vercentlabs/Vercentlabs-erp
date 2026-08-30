#!/usr/bin/env python3
from pathlib import Path
import csv,re,sys
ROOT=Path(__file__).resolve().parents[2]; R=ROOT/'docs/02-register'; errors=[]
def err(x): errors.append(x)
with (R/'FEATURE_REGISTER.csv').open(encoding='utf-8',newline='') as f: fids={r['feature_id'] for r in csv.DictReader(f)}
with (R/'CAPABILITY_REGISTER.csv').open(encoding='utf-8',newline='') as f: caps={r['capability_id'] for r in csv.DictReader(f) if r.get('capability_id')}
with (R/'JOURNEY_REGISTER.csv').open(encoding='utf-8',newline='') as f: rows=list(csv.DictReader(f))
seen=set()
for r in rows:
    jid=r.get('journey_id','').strip()
    if not jid: continue
    if jid in seen: err(f'duplicate journey_id {jid}')
    seen.add(jid)
    for fid in re.split(r'[;,\s]+',r.get('feature_ids','').strip()):
        if fid and fid not in fids: err(f'{jid}: unknown feature {fid}')
    for cid in re.split(r'[;,\s]+',r.get('capability_ids','').strip()):
        if cid and cid not in caps: err(f'{jid}: unknown capability {cid}')
    path=r.get('contract_path','').strip()
    if path and not (ROOT/path).exists(): err(f'{jid}: missing contract_path {path}')
if errors:
    print('JOURNEY VALIDATION FAILED'); [print(' -',e) for e in errors]; sys.exit(1)
print('JOURNEY VALIDATION PASSED')
print(f' - registered journeys: {len(seen)}')
