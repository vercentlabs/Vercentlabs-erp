#!/usr/bin/env python3
from pathlib import Path
import csv,hashlib,json,re,sys
ROOT=Path(__file__).resolve().parents[2]; D=ROOT/'docs'; REG=D/'02-register'; STD=D/'01-standards'
errors=[]
def err(x): errors.append(x)
schema=json.loads((STD/'FEATURE_DOSSIER_SCHEMA.json').read_text(encoding='utf-8'))
if schema.get('schema_version')!='3.0.0': err('dossier schema is not 3.0.0')
with (REG/'FEATURE_REGISTER.csv').open(encoding='utf-8',newline='') as f: rows=list(csv.DictReader(f))
expected=[f'F{i:03d}' for i in range(1,511)]
if len(rows)!=510: err(f'FEATURE_REGISTER count {len(rows)} != 510')
if [r.get('feature_id') for r in rows]!=expected: err('FEATURE_REGISTER is not exact contiguous F001-F510')
h=hashlib.sha256(''.join(f"{r['feature_id']},{r['feature_name']}\n" for r in rows).encode()).hexdigest()
if h!=schema.get('canonical_fingerprint_sha256'): err(f'canonical fingerprint mismatch: {h}')
files=list((D/'03-modules').glob('*/features/F*.md'))
if len(files)!=510: err(f'dossier count {len(files)} != 510')
byid={p.name[:4]:p for p in files}; required=[x[0] for x in schema['sections']]
for r in rows:
    fid=r['feature_id']; p=byid.get(fid)
    if not p: err(f'{fid}: missing dossier'); continue
    txt=p.read_text(encoding='utf-8')
    if not txt.startswith(f"# {fid} — {r['feature_name']}\n"): err(f'{fid}: canonical H1/name mismatch')
    found=re.findall(r'^## \[([A-Z0-9-]+)\] ',txt,re.M)
    if found!=required: err(f'{fid}: SPEC section schema/order mismatch')
    wm=re.search(r'- Working status: `([^`]+)`',txt); gm=re.search(r'- Readiness gate: `([^`]+)`',txt)
    if not wm or wm.group(1) not in schema['allowed_working_statuses']: err(f'{fid}: invalid/missing Working status')
    if not gm or gm.group(1) not in schema['allowed_readiness_gates']: err(f'{fid}: invalid/missing Readiness gate')
required_regs={
 'SUBREQUIREMENT_REGISTER.csv':['requirement_id','feature_id','capability_id','requirement_type','normative_statement','source_ids','test_ids','status'],
 'CAPABILITY_REGISTER.csv':['capability_id','module','name','feature_ids','working_status','readiness_gate'],
 'DEPENDENCY_REGISTER.csv':['dependency_id','source_id','target_id','dependency_type','status'],
 'BENCHMARK_REGISTER.csv':['benchmark_id','evidence_id','module','feature_ids','capability_ids','vendor','product','source_type','source_title','source_url','finding','decision','rationale','freshness_class','status'],
 'PRODUCT_READINESS_MATRIX.csv':['feature_id','working_status','readiness_gate','research','requirements','design','domain','security','implementation','integration','e2e','responsive','accessibility','visual','uat','product_ready'],
 'EVIDENCE_REGISTER.csv':['evidence_id','evidence_type','feature_ids','capability_ids','path_or_url','finding','confidence','status'],
 'DECISION_REGISTER.csv':['decision_id','scope_type','scope_ids','decision','rationale','status'],
 'JOURNEY_REGISTER.csv':['journey_id','name','modules','feature_ids','capability_ids','contract_path','working_status','readiness_gate']}
for fn,cols in required_regs.items():
    p=REG/fn
    if not p.exists(): err(f'missing register {fn}'); continue
    with p.open(encoding='utf-8',newline='') as f: header=next(csv.reader(f),[])
    miss=[c for c in cols if c not in header]
    if miss: err(f'{fn}: missing columns {miss}')
if errors:
    print('DOCUMENTATION BLUEPRINT VALIDATION FAILED')
    for e in errors: print(' -',e)
    sys.exit(1)
print('DOCUMENTATION BLUEPRINT VALIDATION PASSED')
print(' - canonical features: 510 / 510')
print(' - dossier schema: v3.0.0')
print(' - canonical fingerprint: PASS')
print(' - dossier files: 510 / 510')
print(' - required registers: PASS')
