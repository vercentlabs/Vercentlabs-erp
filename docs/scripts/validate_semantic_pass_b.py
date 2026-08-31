#!/usr/bin/env python3
from pathlib import Path
import csv, hashlib, sys, re
ROOT=Path(__file__).resolve().parents[2]; D=ROOT/'docs'; R=D/'02-register'; errors=[]
def rows(p):
    if not p.exists(): errors.append('missing '+str(p.relative_to(ROOT))); return []
    with p.open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
fr=rows(R/'FEATURE_REGISTER.csv'); expected=[f'F{i:03d}' for i in range(1,511)]
if len(fr)!=510 or [r.get('feature_id') for r in fr]!=expected: errors.append('canonical FEATURE_REGISTER must be exact F001-F510')
if fr:
    sha=hashlib.sha256(''.join(f"{r['feature_id']},{r['feature_name']}\n" for r in fr).encode()).hexdigest()
    if sha!='82cfcf68e74cef8c8c8872136d0bfcc0bb619b0517f3a33cfc92bc1e3dde232e': errors.append('canonical fingerprint mismatch')
sem=rows(R/'FEATURE_SEMANTIC_SUBCAPABILITY_REGISTER.csv'); rev=rows(R/'SEMANTIC_REVIEW_REGISTER.csv'); cand=rows(R/'SEMANTIC_OMISSION_CANDIDATE_REGISTER.csv')
if len(sem)!=4080: errors.append(f'semantic sub-capabilities={len(sem)}, expected 4080')
by={fid:[] for fid in expected}
for r in sem:
    if r.get('feature_id') in by: by[r['feature_id']].append(r)
    if r.get('classification')!='B_EXISTING_FID_SUBCAPABILITY': errors.append(f"{r.get('semantic_id')}: unexpected classification")
    if r.get('mandatory')!='YES' or r.get('status')!='FROZEN': errors.append(f"{r.get('semantic_id')}: not mandatory/frozen")
axes={'CORE','DATA','RULE','SEC','UX','INT','EXC','VER'}
for fid,rs in by.items():
    if len(rs)!=8: errors.append(f'{fid}: semantic row count {len(rs)} != 8'); continue
    if {r.get('axis') for r in rs}!=axes: errors.append(f'{fid}: semantic axes incomplete')
    if len({r.get('normative_scope') for r in rs})!=8: errors.append(f'{fid}: duplicate semantic scope inside feature')
if len(rev)!=510 or [r.get('feature_id') for r in rev]!=expected: errors.append('SEMANTIC_REVIEW_REGISTER must contain ordered F001-F510')
else:
    bad=[r['feature_id'] for r in rev if r.get('review_status')!='APPROVED' or r.get('mandatory_omission_found')!='NO' or r.get('new_canonical_feature_required')!='NO']
    if bad: errors.append(f'{len(bad)} semantic reviews not approved/closed')
if any(r.get('classification')=='A_MISSING_MANDATORY_FEATURE' and r.get('status') not in {'RESOLVED','NOT_APPLICABLE'} for r in cand): errors.append('unresolved class-A mandatory omission exists')
if not cand: errors.append('omission candidate register is empty')
# Dossier linkage and no F511+
for r in fr:
    ms={'CRM':'crm','Sales':'sales','Procurement':'procurement','Stock / Inventory':'stock','Manufacturing':'manufacturing','Projects':'projects','Assets':'assets','Point of Sale':'point-of-sale','Quality':'quality','Support / Customer Service':'support','HR & Payroll':'hr-payroll','Accounting / Finance':'accounting'}[r['module']]
    matches=sorted((D/'03-modules'/ms/'features').glob(f"{r['feature_id']}-*.md"))
    if len(matches)!=1: errors.append(f"{r['feature_id']}: expected exactly one dossier, found {len(matches)}"); continue
    p=matches[0]
    t=p.read_text(encoding='utf-8')
    if '## [PASS-B-SEMANTIC-FREEZE]' not in t: errors.append(f"{r['feature_id']}: missing Pass B semantic section")
    for i in range(1,9):
        if f"{r['feature_id']}-SEM-{i:02d}" not in t: errors.append(f"{r['feature_id']}: missing SEM-{i:02d} linkage")
for p in [D/'00-program/FINAL_PASS_B_REPORT.md',D/'01-standards/SEMANTIC_SUBFEATURE_FREEZE_STANDARD.md']:
    if p.exists() and re.search(r'\bF(?:51[1-9]|5[2-9]\d|[6-9]\d{2,})\b',p.read_text(encoding='utf-8')): errors.append(f'{p.name}: invented F-ID above F510')
if errors:
    print('FINAL PASS B SEMANTIC VALIDATION FAILED')
    for e in errors[:120]: print(' -',e)
    sys.exit(1)
print('FINAL PASS B SEMANTIC VALIDATION PASSED')
print(' - canonical features reviewed: 510 / 510')
print(' - semantic sub-capabilities: 4080 (8 per feature)')
print(f' - omission candidates dispositioned: {len(cand)}')
print(' - unresolved class-A mandatory omissions: 0')
print(' - canonical F001-F510 count/fingerprint preserved')
print(' - implementation/product readiness not promoted')
