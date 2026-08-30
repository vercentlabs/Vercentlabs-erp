#!/usr/bin/env python3
from pathlib import Path
import csv,re,sys
ROOT=Path(__file__).resolve().parents[2]; R=ROOT/'docs/02-register'; errors=[]
def err(x): errors.append(x)
with (R/'FEATURE_REGISTER.csv').open(encoding='utf-8',newline='') as f: fids={r['feature_id'] for r in csv.DictReader(f)}
with (R/'BENCHMARK_REGISTER.csv').open(encoding='utf-8',newline='') as f: rows=list(csv.DictReader(f))
seen=set(); evidence=set(); decisions={'REQUIRED','DIFFERENTIATOR','NOT_APPLICABLE'}
for r in rows:
    bid=r.get('benchmark_id','').strip(); eid=r.get('evidence_id','').strip(); status=r.get('status','').strip()
    if bid:
        if bid in seen: err(f'duplicate benchmark_id {bid}')
        seen.add(bid)
    if eid:
        if eid in evidence: err(f'duplicate benchmark evidence_id {eid}')
        evidence.add(eid)
    for fid in re.split(r'[;,\s]+',r.get('feature_ids','').strip()):
        if fid and fid not in fids: err(f'{bid or eid}: unknown feature {fid}')
    if status in {'EVIDENCE_CAPTURED','REVIEWED','APPROVED'}:
        for k in ('evidence_id','source_title','source_url','finding','decision'):
            if not r.get(k,'').strip(): err(f'{bid}: {status} row missing {k}')
        if r.get('decision','').strip() not in decisions: err(f"{bid}: invalid decision {r.get('decision')}")
        if r.get('decision','').strip()=='NOT_APPLICABLE' and not r.get('rationale','').strip(): err(f'{bid}: NOT_APPLICABLE requires rationale')
    if status=='SOURCE_LIBRARY' and not r.get('source_url','').strip(): err(f'{bid}: SOURCE_LIBRARY missing URL')
if errors:
    print('BENCHMARK VALIDATION FAILED'); [print(' -',e) for e in errors]; sys.exit(1)
print('BENCHMARK VALIDATION PASSED')
print(f' - source/evidence rows: {len(rows)}')
print(f' - captured evidence IDs: {len(evidence)}')
