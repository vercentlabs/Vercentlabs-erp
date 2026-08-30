#!/usr/bin/env python3
from pathlib import Path
import csv,json,re,sys
ROOT=Path(__file__).resolve().parents[2]; D=ROOT/'docs'; R=D/'02-register'; S=D/'01-standards'
errors=[]
def err(x): errors.append(x)
schema=json.loads((S/'FEATURE_DOSSIER_SCHEMA.json').read_text(encoding='utf-8')); types=set(schema['requirement_id_types'])
with (R/'FEATURE_REGISTER.csv').open(encoding='utf-8',newline='') as f: fids={r['feature_id'] for r in csv.DictReader(f)}
with (R/'SUBREQUIREMENT_REGISTER.csv').open(encoding='utf-8',newline='') as f: rows=list(csv.DictReader(f))
seen=set(); req_ids=set()
for r in rows:
    rid=r['requirement_id'].strip(); fid=r['feature_id'].strip(); typ=r['requirement_type'].strip()
    if not rid: continue
    if rid in seen: err(f'duplicate requirement_id {rid}')
    seen.add(rid); req_ids.add(rid)
    if fid not in fids: err(f'{rid}: unknown feature_id {fid}')
    if typ not in types: err(f'{rid}: unknown requirement_type {typ}')
    m=re.fullmatch(r'(F\d{3})-([A-Z0-9]+)-(\d{3})',rid)
    if not m: err(f'{rid}: invalid nested requirement ID format')
    else:
        if m.group(1)!=fid: err(f'{rid}: parent feature does not match {fid}')
        if m.group(2)!=typ: err(f'{rid}: ID type {m.group(2)} != column type {typ}')
# Basic capability/dependency references; empty values are allowed while UNSPECIFIED.
with (R/'CAPABILITY_REGISTER.csv').open(encoding='utf-8',newline='') as f: caps=[r for r in csv.DictReader(f) if r.get('capability_id','').strip()]
capids={r['capability_id'].strip() for r in caps}
for c in caps:
    for fid in re.split(r'[;,\s]+',c.get('feature_ids','').strip()):
        if fid and fid not in fids: err(f"{c['capability_id']}: unknown feature {fid}")
with (R/'DEPENDENCY_REGISTER.csv').open(encoding='utf-8',newline='') as f: deps=[r for r in csv.DictReader(f) if r.get('dependency_id','').strip()]
known=fids|capids|req_ids
for d in deps:
    for k in ('source_id','target_id'):
        v=d.get(k,'').strip()
        if v and v not in known: err(f"{d['dependency_id']}: unknown {k} {v}")
if errors:
    print('REFERENCE VALIDATION FAILED'); [print(' -',e) for e in errors]; sys.exit(1)
print('REFERENCE VALIDATION PASSED')
print(f' - subrequirements: {len(req_ids)}')
print(f' - capabilities: {len(capids)}')
print(f' - dependencies: {len(deps)}')
