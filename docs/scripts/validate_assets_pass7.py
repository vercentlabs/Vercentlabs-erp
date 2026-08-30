#!/usr/bin/env python3
from pathlib import Path
import csv,re,sys
ROOT=Path(__file__).resolve().parents[2];D=ROOT/'docs';R=D/'02-register';errors=[]
EXPECTED=[('F231', 'Asset register'), ('F232', 'Asset categories'), ('F233', 'Asset identification and code'), ('F234', 'Asset location'), ('F235', 'Custodian'), ('F236', 'Department'), ('F237', 'Purchase and capitalization'), ('F238', 'Asset creation from procurement'), ('F239', 'Asset transfers'), ('F240', 'Asset assignment'), ('F241', 'Asset movement history'), ('F242', 'Asset value'), ('F243', 'Useful life'), ('F244', 'Salvage value'), ('F245', 'Straight-line depreciation'), ('F246', 'Declining-balance depreciation'), ('F247', 'Units-of-production depreciation'), ('F248', 'Depreciation schedule'), ('F249', 'Depreciation posting'), ('F250', 'Asset revaluation'), ('F251', 'Asset impairment'), ('F252', 'Asset maintenance'), ('F253', 'Preventive maintenance'), ('F254', 'Maintenance schedule'), ('F255', 'Repair history'), ('F256', 'Downtime'), ('F257', 'Warranty'), ('F258', 'Inspection'), ('F259', 'Calibration'), ('F260', 'Physical verification and audit'), ('F261', 'Barcode / QR identification'), ('F262', 'Asset disposal'), ('F263', 'Asset sale'), ('F264', 'Asset scrap'), ('F265', 'Gain / loss on disposal'), ('F266', 'Asset accounting integration'), ('F267', 'Asset reports')];FIDS=set(x[0] for x in EXPECTED)
def rows(fn):
 with (R/fn).open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
def split(c):return set(x for x in re.split(r'[;,\s]+',c or '') if x)
def err(s):errors.append(s)
fr={r['feature_id']:r for r in rows('FEATURE_REGISTER.csv') if r['feature_id'] in FIDS};pr={r['feature_id']:r for r in rows('PRODUCT_READINESS_MATRIX.csv') if r['feature_id'] in FIDS};subs=[r for r in rows('SUBREQUIREMENT_REGISTER.csv') if r.get('feature_id') in FIDS];bms=[r for r in rows('BENCHMARK_REGISTER.csv') if r.get('status') in {'EVIDENCE_CAPTURED','REVIEWED','APPROVED'}];evs=[r for r in rows('EVIDENCE_REGISTER.csv') if r.get('status') in {'VERIFIED','APPROVED'}]
if len(fr)!=37:err(f'feature rows {len(fr)} != 37')
minima={'CAP':3,'FR':3,'US':2,'FLOW':2,'BR':2,'DATA':2,'VAL':2,'CALC':1,'UX':3,'SEC':2,'AUTO':1,'APP':1,'NOTIF':1,'REP':1,'AI':1,'INT':2,'API':2,'PERF':1,'OBS':1,'E2E':2,'UAT':2}
for fid,name in EXPECTED:
 r=fr.get(fid);p=pr.get(fid)
 if not r or r.get('module')!='Assets' or r.get('feature_name')!=name:err(f'{fid}: canonical mismatch')
 elif r.get('specification_status')!='SPECIFICATION_READY' or r.get('benchmark_status') not in {'RESEARCHED','RESEARCH_COMPLETE'} or r.get('current_code_status')!='AUDITED' or r.get('pass')!='7':err(f'{fid}: register status mismatch')
 if not p or p.get('working_status')!='SPECIFICATION_READY' or p.get('readiness_gate')!='SPECIFICATION_READY':err(f'{fid}: readiness matrix spec gate mismatch')
 elif p.get('product_ready')=='YES':err(f'{fid}: product readiness improperly promoted')
 rr=[x for x in subs if x['feature_id']==fid and x.get('status') in {'APPROVED','READY'}]
 if len(rr)!=37:err(f'{fid}: requirement count {len(rr)} != 37')
 for typ,n in minima.items():
  c=sum(1 for x in rr if x['requirement_type']==typ)
  if c<n:err(f'{fid}: {typ} count {c} < {n}')
 bb=[x for x in bms if fid in split(x.get('feature_ids')) and (x.get('benchmark_id') or '').startswith('AST-P7-BM-')]
 if len(bb)<2:err(f'{fid}: benchmark evidence {len(bb)} < 2')
 ce=[x for x in evs if fid in split(x.get('feature_ids')) and x.get('evidence_type')=='CODE_AUDIT' and (x.get('evidence_id') or '').startswith('AST-P7-CODE-')]
 if len(ce)<1:err(f'{fid}: missing verified current-code evidence')
 m=list((D/'03-modules/assets/features').glob(fid+'-*.md'))
 if len(m)!=1:err(f'{fid}: dossier file count {len(m)}')
 elif 'SPECIFICATION_READY' not in m[0].read_text(encoding='utf-8'):err(f'{fid}: dossier not spec-ready')
for path in ['docs/03-modules/assets/research/ASSETS_PASS7_RESEARCH_SUMMARY.md','docs/03-modules/assets/architecture/ASSETS_REFERENCE_ARCHITECTURE.md','docs/03-modules/assets/architecture/ASSETS_PERMISSION_MATRIX.md','docs/03-modules/assets/architecture/AST_JOURNEY_VALUE_ADJUSTMENT.md','docs/03-modules/assets/architecture/AST_JOURNEY_INSPECTION_CALIBRATION.md','docs/03-modules/assets/architecture/AST_JOURNEY_PHYSICAL_VERIFICATION.md','docs/04-cross-module/PROCUREMENT_TO_ASSETS_ACQUISITION.md','docs/04-cross-module/ASSETS_TO_ACCOUNTING_DEPRECIATION.md','docs/04-cross-module/ASSETS_TO_ACCOUNTING_DISPOSAL.md','docs/04-cross-module/ASSETS_TO_STOCK_MAINTENANCE_PARTS.md','docs/04-cross-module/ASSETS_TO_HR_CUSTODY.md','docs/04-cross-module/ASSETS_TO_MANUFACTURING_MAINTENANCE.md','docs/04-cross-module/PROJECTS_TO_ASSETS_CAPITALIZATION.md','docs/11-visual-assets/wireframes/ASSETS_PASS7_WORKSPACES.md','docs/07-testing/ASSETS_PASS7_TEST_STRATEGY.md','docs/08-uat/ASSETS_PASS7_UAT_PLAN.md','docs/06-current-code-audit/latest/ASSETS_PASS7_CODE_AUDIT.md','docs/00-program/ASSETS_PASS7_SPECIFICATION_REPORT.md']:
 if not (ROOT/path).exists():err('missing '+path)
alltext='\n'.join(p.read_text(encoding='utf-8') for p in (D/'03-modules/assets/features').glob('F*.md') if p.name[:4] in FIDS)
for phrase in ['depreciation','salvage','revaluation','impairment','period','maker-checker','idempotency','calibration','barcode','physical verification','gain/loss','reconciliation','mobile','WCAG']:
 if phrase.lower() not in alltext.lower():err('critical control absent: '+phrase)
if errors:
 print('ASSETS PASS 7 VALIDATION FAILED');[print(' -',x) for x in errors];sys.exit(1)
print('ASSETS PASS 7 VALIDATION PASSED')
print(' - canonical Assets features: 37 / 37')
print(' - canonical F231-F267 names: PASS')
print(' - specification-ready dossiers: 37 / 37')
print(' - 21-type requirement contracts: PASS')
print(' - >=2 official benchmark findings per feature: PASS')
print(' - verified current-code evidence per feature: PASS')
print(' - lifecycle/custody/depreciation/maintenance/verification/disposal controls: PASS')
print(' - Procurement/Stock/Manufacturing/Projects/HR/Accounting contracts: PASS')
print(' - visual/mobile/accessibility/testing/UAT artifacts: PASS')
print(' - product readiness promotion: NONE')
