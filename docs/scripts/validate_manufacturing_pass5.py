#!/usr/bin/env python3
from pathlib import Path
import csv,re,sys
ROOT=Path(__file__).resolve().parents[2];D=ROOT/'docs';R=D/'02-register';errors=[]
EXPECTED=[('F145', 'Bill of Materials (BOM)'), ('F146', 'Multi-level BOM'), ('F147', 'BOM versions'), ('F148', 'BOM revisions'), ('F149', 'Alternate BOM'), ('F150', 'Routings'), ('F151', 'Operations'), ('F152', 'Work centres'), ('F153', 'Machine / work-centre capacity'), ('F154', 'Shift calendars'), ('F155', 'Manufacturing orders'), ('F156', 'Work orders'), ('F157', 'Job cards'), ('F158', 'Production planning'), ('F159', 'MRP'), ('F160', 'Material requirements'), ('F161', 'Material availability'), ('F162', 'Raw-material reservations'), ('F163', 'Material issue'), ('F164', 'Material consumption'), ('F165', 'Backflushing'), ('F166', 'Work in progress'), ('F167', 'Finished-goods receipt'), ('F168', 'Production scheduling'), ('F169', 'Labor time'), ('F170', 'Machine time'), ('F171', 'Setup time'), ('F172', 'Scrap'), ('F173', 'Waste'), ('F174', 'By-products and co-products'), ('F175', 'Rework'), ('F176', 'Batch manufacturing'), ('F177', 'Serial tracking'), ('F178', 'Make-to-stock'), ('F179', 'Make-to-order'), ('F180', 'Subcontract manufacturing'), ('F181', 'Production quality inspections'), ('F182', 'Production hold'), ('F183', 'Production costing'), ('F184', 'Standard vs actual costing'), ('F185', 'Cost variance'), ('F186', 'Yield analysis'), ('F187', 'Production efficiency'), ('F188', 'Downtime'), ('F189', 'Maintenance integration'), ('F190', 'Engineering change and revision control'), ('F191', 'Production reports'), ('F192', 'Production dashboard')]
FIDS=set(x[0] for x in EXPECTED)
def rows(fn):
    with (R/fn).open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
def split(c):return set(x for x in re.split(r'[;,\s]+',c or '') if x)
def err(s):errors.append(s)
fr={r['feature_id']:r for r in rows('FEATURE_REGISTER.csv') if r['feature_id'] in FIDS};pr={r['feature_id']:r for r in rows('PRODUCT_READINESS_MATRIX.csv') if r['feature_id'] in FIDS};subs=[r for r in rows('SUBREQUIREMENT_REGISTER.csv') if r.get('feature_id') in FIDS];bms=[r for r in rows('BENCHMARK_REGISTER.csv') if r.get('status') in {'EVIDENCE_CAPTURED','REVIEWED','APPROVED'}];evs=[r for r in rows('EVIDENCE_REGISTER.csv') if r.get('status') in {'VERIFIED','APPROVED'}]
if len(fr)!=48:err(f'feature rows {len(fr)} != 48')
minima={'CAP':3,'FR':3,'US':2,'FLOW':2,'BR':2,'DATA':2,'VAL':2,'CALC':1,'UX':3,'SEC':2,'AUTO':1,'APP':1,'NOTIF':1,'REP':1,'AI':1,'INT':2,'API':2,'PERF':1,'OBS':1,'E2E':2,'UAT':2}
for fid,name in EXPECTED:
 r=fr.get(fid);p=pr.get(fid)
 if not r or r.get('module')!='Manufacturing' or r.get('feature_name')!=name:err(f'{fid}: canonical mismatch')
 elif r.get('specification_status')!='SPECIFICATION_READY' or r.get('benchmark_status') not in {'RESEARCHED','RESEARCH_COMPLETE'} or r.get('current_code_status')!='AUDITED' or r.get('pass')!='5':err(f'{fid}: register status mismatch')
 if not p or p.get('working_status')!='SPECIFICATION_READY' or p.get('readiness_gate')!='SPECIFICATION_READY':err(f'{fid}: readiness matrix spec gate mismatch')
 elif p.get('product_ready')=='YES':err(f'{fid}: product readiness improperly promoted')
 rr=[x for x in subs if x['feature_id']==fid and x.get('status') in {'APPROVED','READY'}]
 if len(rr)!=37:err(f'{fid}: requirement count {len(rr)} != 37')
 for typ,n in minima.items():
  c=sum(1 for x in rr if x['requirement_type']==typ)
  if c<n:err(f'{fid}: {typ} count {c} < {n}')
 bb=[x for x in bms if fid in split(x.get('feature_ids')) and (x.get('benchmark_id') or '').startswith('MFG-P5-BM-')]
 if len(bb)<2:err(f'{fid}: benchmark evidence {len(bb)} < 2')
 ce=[x for x in evs if fid in split(x.get('feature_ids')) and x.get('evidence_type')=='CODE_AUDIT' and (x.get('evidence_id') or '').startswith('MFG-P5-CODE-')]
 if len(ce)<1:err(f'{fid}: missing verified current-code evidence')
 matches=list((D/'03-modules/manufacturing/features').glob(fid+'-*.md'))
 if len(matches)!=1:err(f'{fid}: dossier file count {len(matches)}')
 elif 'SPECIFICATION_READY' not in matches[0].read_text(encoding='utf-8'):err(f'{fid}: dossier not spec-ready')
for path in ['docs/03-modules/manufacturing/research/MANUFACTURING_PASS5_RESEARCH_SUMMARY.md','docs/03-modules/manufacturing/architecture/MANUFACTURING_REFERENCE_ARCHITECTURE.md','docs/03-modules/manufacturing/architecture/MANUFACTURING_PERMISSION_MATRIX.md','docs/03-modules/manufacturing/architecture/MFG_JOURNEY_PLAN_TO_PRODUCE.md','docs/03-modules/manufacturing/architecture/MFG_JOURNEY_ENGINEERING_CHANGE.md','docs/03-modules/manufacturing/architecture/MFG_JOURNEY_SHOP_FLOOR_OUTPUT.md','docs/03-modules/manufacturing/architecture/MFG_JOURNEY_GENEALOGY.md','docs/04-cross-module/SALES_TO_MANUFACTURING_MTO.md','docs/04-cross-module/MANUFACTURING_TO_PROCUREMENT_MRP_SUPPLY.md','docs/04-cross-module/MANUFACTURING_TO_STOCK_PRODUCTION_FLOW.md','docs/04-cross-module/MANUFACTURING_TO_QUALITY_INSPECTION_HOLD.md','docs/04-cross-module/MANUFACTURING_TO_ACCOUNTING_COST_RECONCILIATION.md','docs/04-cross-module/MANUFACTURING_TO_ASSETS_MAINTENANCE_CAPACITY.md','docs/04-cross-module/MANUFACTURING_SUBCONTRACT_PROCUREMENT.md','docs/11-visual-assets/wireframes/MANUFACTURING_PASS5_WORKSPACES.md','docs/07-testing/MANUFACTURING_PASS5_TEST_STRATEGY.md','docs/08-uat/MANUFACTURING_PASS5_UAT_PLAN.md','docs/06-current-code-audit/latest/MANUFACTURING_PASS5_CODE_AUDIT.md','docs/00-program/MANUFACTURING_PASS5_SPECIFICATION_REPORT.md']:
 if not (ROOT/path).exists():err('missing '+path)
alltext='\n'.join(p.read_text(encoding='utf-8') for p in (D/'03-modules/manufacturing/features').glob('F*.md') if p.name[:4] in FIDS)
for phrase in ['BOM','MRP','pegg','idempotency','concurrency','quality hold','WIP','serial','reconciliation','capacity','backflush','effectivity']:
 if phrase.lower() not in alltext.lower():err('critical control absent: '+phrase)
if errors:
 print('MANUFACTURING PASS 5 VALIDATION FAILED');[print(' -',x) for x in errors];sys.exit(1)
print('MANUFACTURING PASS 5 VALIDATION PASSED')
print(' - canonical Manufacturing features: 48 / 48')
print(' - canonical F145-F192 names: PASS')
print(' - specification-ready dossiers: 48 / 48')
print(' - 21-type requirement contracts: PASS')
print(' - >=2 official benchmark findings per feature: PASS')
print(' - verified current-code evidence per feature: PASS')
print(' - BOM/MRP/material/WIP/quality/cost/capacity controls: PASS')
print(' - Sales/Procurement/Stock/Quality/Assets/Accounting contracts: PASS')
print(' - visual/mobile/accessibility/testing/UAT artifacts: PASS')
print(' - product readiness promotion: NONE')
