#!/usr/bin/env python3
from pathlib import Path
import csv, json, re, sys

ROOT=Path(__file__).resolve().parents[2]
D=ROOT/'docs'; R=D/'02-register'; S=D/'01-standards'
errors=[]
def err(msg): errors.append(msg)

schema=json.loads((S/'FEATURE_DOSSIER_SCHEMA.json').read_text(encoding='utf-8'))
types=list(schema.get('requirement_id_types',{}).keys())
if schema.get('schema_version')!='3.0.0': err(f"schema_version={schema.get('schema_version')} expected 3.0.0")
if len(types)!=21: err(f'expected 21 nested requirement types, found {len(types)}')

with (R/'FEATURE_REGISTER.csv').open(encoding='utf-8',newline='') as f:
    rows=list(csv.DictReader(f))
if len(rows)!=510: err(f'expected 510 canonical register rows, found {len(rows)}')
expected=[f'F{i:03d}' for i in range(1,511)]
if [r.get('feature_id','').strip() for r in rows]!=expected: err('canonical register is not exact contiguous F001-F510')

files=list((D/'03-modules').glob('*/features/F*.md'))
by={}
for p in files:
    m=re.match(r'(F\d{3})-',p.name)
    if m: by.setdefault(m.group(1),[]).append(p)

pass_count=0
for fid in expected:
    matches=by.get(fid,[])
    if len(matches)!=1:
        err(f'{fid}: expected exactly one dossier, found {len(matches)}')
        continue
    txt=matches[0].read_text(encoding='utf-8')
    missing=[]
    for typ in types:
        if not re.search(rf'(?<![A-Z0-9]){re.escape(fid)}-{re.escape(typ)}-(?:###(?!#)|\d{{3}}\b)',txt):
            missing.append(typ)
    if missing:
        err(f"{fid}: missing nested requirement contract types {','.join(missing)}")
    else:
        pass_count+=1

if errors:
    print('REQUIREMENT CONTRACT VALIDATION FAILED')
    for e in errors: print(' -',e)
    sys.exit(1)
print('REQUIREMENT CONTRACT VALIDATION PASSED')
print(f' - schema nested requirement types: {len(types)} / 21')
print(f' - dossiers satisfying all type contracts: {pass_count} / 510')
