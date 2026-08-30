#!/usr/bin/env python3
from pathlib import Path
import csv, hashlib, json, re, sys
ROOT=Path(__file__).resolve().parents[2]
D=ROOT/'docs'; REG=D/'02-register'; STD=D/'01-standards'
errors=[]
def err(msg): errors.append(msg)
try:
    schema=json.loads((STD/'FEATURE_DOSSIER_SCHEMA.json').read_text(encoding='utf-8'))
except Exception as e:
    print(f'FAIL: cannot load FEATURE_DOSSIER_SCHEMA.json: {e}'); sys.exit(1)
with (REG/'FEATURE_REGISTER.csv').open(encoding='utf-8',newline='') as f: rows=list(csv.DictReader(f))
if len(rows)!=510: err(f'FEATURE_REGISTER row count {len(rows)} != 510')
expected=[f'F{i:03d}' for i in range(1,511)]
ids=[r.get('feature_id') for r in rows]
if ids!=expected: err('FEATURE_REGISTER IDs are not exact contiguous F001-F510')
raw=''.join(f"{r['feature_id']},{r['feature_name']}\n" for r in rows).encode()
h=hashlib.sha256(raw).hexdigest()
if h!=schema['canonical_fingerprint_sha256']: err(f'canonical fingerprint mismatch: {h}')
files=list((D/'03-modules').glob('*/features/F*.md'))
if len(files)!=510: err(f'dossier count {len(files)} != 510')
byid={p.name[:4]:p for p in files}
required=[sid for sid,_ in schema['sections']]
allowed=set(schema['allowed_specification_statuses'])
for r in rows:
    fid=r['feature_id']; p=byid.get(fid)
    if not p: err(f'{fid}: dossier missing'); continue
    txt=p.read_text(encoding='utf-8')
    if not txt.startswith(f"# {fid} — {r['feature_name']}\n"): err(f'{fid}: H1/name mismatch')
    found=re.findall(r'^## \[([A-Z0-9-]+)\] ',txt,re.M)
    if found!=required: err(f'{fid}: section schema/order mismatch')
    m=re.search(r'- Specification status: `([^`]+)`',txt)
    if not m: err(f'{fid}: missing specification status')
    elif m.group(1) not in allowed: err(f'{fid}: invalid specification status {m.group(1)}')
# Registers required by the program.
required_registers={
 'SUBREQUIREMENT_REGISTER.csv':['requirement_id','feature_id','type','statement','status','source','test_evidence'],
 'CAPABILITY_REGISTER.csv':['capability_id','module','name','feature_ids','status','owner_notes'],
 'DEPENDENCY_REGISTER.csv':['dependency_id','source_feature_or_capability','target_feature_or_capability','dependency_type','description','status'],
 'PRODUCT_READINESS_MATRIX.csv':['feature_id'],
 'BENCHMARK_REGISTER.csv':['benchmark_id','evidence_id','module','vendor','product','source_type','source_title','source_url','source_published_or_updated_on','accessed_on','feature_ids','capability_ids','finding','decision','rationale','status']}
for fn,cols in required_registers.items():
    p=REG/fn
    if not p.exists(): err(f'missing register {fn}'); continue
    with p.open(encoding='utf-8',newline='') as f:
        rd=csv.reader(f); header=next(rd,[])
    miss=[c for c in cols if c not in header]
    if miss: err(f'{fn}: missing columns {miss}')
if errors:
    print('DOCUMENTATION VALIDATION FAILED')
    for e in errors: print(' -',e)
    sys.exit(1)
print('DOCUMENTATION VALIDATION PASSED')
print(' - canonical features: 510')
print(' - dossier schema version:',schema['schema_version'])
print(' - dossier files: 510')
print(' - canonical fingerprint: PASS')
print(' - required registers: PASS')
