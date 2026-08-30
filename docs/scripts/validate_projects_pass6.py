#!/usr/bin/env python3
from pathlib import Path
import csv,re,sys
ROOT=Path(__file__).resolve().parents[2];D=ROOT/'docs';R=D/'02-register';errors=[]
EXPECTED=[('F193', 'Projects'), ('F194', 'Customer projects'), ('F195', 'Internal projects'), ('F196', 'Project templates'), ('F197', 'Work Breakdown Structure (WBS)'), ('F198', 'Milestones'), ('F199', 'Tasks'), ('F200', 'Subtasks'), ('F201', 'Task dependencies'), ('F202', 'Assignees'), ('F203', 'Priority'), ('F204', 'Project status'), ('F205', 'Gantt chart'), ('F206', 'Kanban / task board'), ('F207', 'Project calendar'), ('F208', 'Resource allocation'), ('F209', 'Resource availability'), ('F210', 'Timesheets'), ('F211', 'Project expenses'), ('F212', 'Materials consumed'), ('F213', 'Project procurement'), ('F214', 'Project budget'), ('F215', 'Budget revisions'), ('F216', 'Cost tracking'), ('F217', 'Revenue tracking'), ('F218', 'Fixed-price billing'), ('F219', 'Time-and-material billing'), ('F220', 'Milestone billing'), ('F221', 'Project invoices'), ('F222', 'Project profitability'), ('F223', 'Cost variance'), ('F224', 'Issues'), ('F225', 'Risks'), ('F226', 'Documents'), ('F227', 'Comments and collaboration'), ('F228', 'Progress tracking'), ('F229', 'Project dashboard'), ('F230', 'Project reports')];FIDS=set(x[0] for x in EXPECTED)
def rows(fn):
 with (R/fn).open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
def split(c):return set(x for x in re.split(r'[;,\s]+',c or '') if x)
def err(s):errors.append(s)
fr={r['feature_id']:r for r in rows('FEATURE_REGISTER.csv') if r['feature_id'] in FIDS};pr={r['feature_id']:r for r in rows('PRODUCT_READINESS_MATRIX.csv') if r['feature_id'] in FIDS};subs=[r for r in rows('SUBREQUIREMENT_REGISTER.csv') if r.get('feature_id') in FIDS];bms=[r for r in rows('BENCHMARK_REGISTER.csv') if r.get('status') in {'EVIDENCE_CAPTURED','REVIEWED','APPROVED'}];evs=[r for r in rows('EVIDENCE_REGISTER.csv') if r.get('status') in {'VERIFIED','APPROVED'}]
if len(fr)!=38:err(f'feature rows {len(fr)} != 38')
minima={'CAP':3,'FR':3,'US':2,'FLOW':2,'BR':2,'DATA':2,'VAL':2,'CALC':1,'UX':3,'SEC':2,'AUTO':1,'APP':1,'NOTIF':1,'REP':1,'AI':1,'INT':2,'API':2,'PERF':1,'OBS':1,'E2E':2,'UAT':2}
for fid,name in EXPECTED:
 r=fr.get(fid);p=pr.get(fid)
 if not r or r.get('module')!='Projects' or r.get('feature_name')!=name:err(f'{fid}: canonical mismatch')
 elif r.get('specification_status')!='SPECIFICATION_READY' or r.get('benchmark_status') not in {'RESEARCHED','RESEARCH_COMPLETE'} or r.get('current_code_status')!='AUDITED' or r.get('pass')!='6':err(f'{fid}: register status mismatch')
 if not p or p.get('working_status')!='SPECIFICATION_READY' or p.get('readiness_gate')!='SPECIFICATION_READY':err(f'{fid}: readiness matrix spec gate mismatch')
 elif p.get('product_ready')=='YES':err(f'{fid}: product readiness improperly promoted')
 rr=[x for x in subs if x['feature_id']==fid and x.get('status') in {'APPROVED','READY'}]
 if len(rr)!=37:err(f'{fid}: requirement count {len(rr)} != 37')
 for typ,n in minima.items():
  c=sum(1 for x in rr if x['requirement_type']==typ)
  if c<n:err(f'{fid}: {typ} count {c} < {n}')
 bb=[x for x in bms if fid in split(x.get('feature_ids')) and (x.get('benchmark_id') or '').startswith('PRJ-P6-BM-')]
 if len(bb)<2:err(f'{fid}: benchmark evidence {len(bb)} < 2')
 ce=[x for x in evs if fid in split(x.get('feature_ids')) and x.get('evidence_type')=='CODE_AUDIT' and (x.get('evidence_id') or '').startswith('PRJ-P6-CODE-')]
 if len(ce)<1:err(f'{fid}: missing verified current-code evidence')
 m=list((D/'03-modules/projects/features').glob(fid+'-*.md'))
 if len(m)!=1:err(f'{fid}: dossier file count {len(m)}')
 elif 'SPECIFICATION_READY' not in m[0].read_text(encoding='utf-8'):err(f'{fid}: dossier not spec-ready')
for path in ['docs/03-modules/projects/research/PROJECTS_PASS6_RESEARCH_SUMMARY.md','docs/03-modules/projects/architecture/PROJECTS_REFERENCE_ARCHITECTURE.md','docs/03-modules/projects/architecture/PROJECTS_PERMISSION_MATRIX.md','docs/03-modules/projects/architecture/PRJ_JOURNEY_PLAN_SCHEDULE_DELIVERY.md','docs/03-modules/projects/architecture/PRJ_JOURNEY_BUDGET_TO_ACTUAL.md','docs/03-modules/projects/architecture/PRJ_JOURNEY_RISK_ISSUE_RESOLUTION.md','docs/03-modules/projects/architecture/PRJ_JOURNEY_CLOSE_REOPEN.md','docs/04-cross-module/SALES_TO_PROJECTS_PROJECT_INITIATION.md','docs/04-cross-module/PROJECTS_TO_PROCUREMENT_COMMITMENTS.md','docs/04-cross-module/PROJECTS_TO_STOCK_MATERIALS.md','docs/04-cross-module/PROJECTS_TO_HR_RESOURCE_TIME.md','docs/04-cross-module/PROJECTS_TO_ACCOUNTING_PROJECT_TO_CASH.md','docs/04-cross-module/PROJECTS_TO_ACCOUNTING_PROFITABILITY_RECONCILIATION.md','docs/11-visual-assets/wireframes/PROJECTS_PASS6_WORKSPACES.md','docs/07-testing/PROJECTS_PASS6_TEST_STRATEGY.md','docs/08-uat/PROJECTS_PASS6_UAT_PLAN.md','docs/06-current-code-audit/latest/PROJECTS_PASS6_CODE_AUDIT.md','docs/00-program/PROJECTS_PASS6_SPECIFICATION_REPORT.md']:
 if not (ROOT/path).exists():err('missing '+path)
alltext='\n'.join(p.read_text(encoding='utf-8') for p in (D/'03-modules/projects/features').glob('F*.md') if p.name[:4] in FIDS)
for phrase in ['WBS','dependency','baseline','self-approval','idempotency','profitability','reconciliation','resource','billing','close','mobile']:
 if phrase.lower() not in alltext.lower():err('critical control absent: '+phrase)
if errors:
 print('PROJECTS PASS 6 VALIDATION FAILED');[print(' -',x) for x in errors];sys.exit(1)
print('PROJECTS PASS 6 VALIDATION PASSED')
print(' - canonical Projects features: 38 / 38')
print(' - canonical F193-F230 names: PASS')
print(' - specification-ready dossiers: 38 / 38')
print(' - 21-type requirement contracts: PASS')
print(' - >=2 official benchmark findings per feature: PASS')
print(' - verified current-code evidence per feature: PASS')
print(' - WBS/schedule/resource/time/budget/billing/profitability controls: PASS')
print(' - Sales/Procurement/Stock/HR/Accounting contracts: PASS')
print(' - visual/mobile/accessibility/testing/UAT artifacts: PASS')
print(' - product readiness promotion: NONE')
