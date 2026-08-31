#!/usr/bin/env python3
from pathlib import Path
import csv, hashlib, json, re, sys
ROOT=Path(__file__).resolve().parents[2];D=ROOT/'docs';R=D/'02-register'; errors=[]
def err(x): errors.append(x)
def rows(p):
    if not p.exists(): return []
    with p.open(encoding='utf-8',newline='') as f:return list(csv.DictReader(f))
fr=rows(R/'FEATURE_REGISTER.csv')
if len(fr)!=510: err(f'canonical features={len(fr)}, expected 510')
if [r.get('feature_id') for r in fr] != [f'F{i:03d}' for i in range(1,511)]: err('feature IDs are not exact F001-F510')
if fr:
    sha=hashlib.sha256(''.join(f"{r['feature_id']},{r['feature_name']}\n" for r in fr).encode()).hexdigest()
    if sha!='82cfcf68e74cef8c8c8872136d0bfcc0bb619b0517f3a33cfc92bc1e3dde232e': err('canonical fingerprint mismatch')
sp=rows(D/'04-shared-platform/SHARED_PLATFORM_REGISTER.csv')
if len(sp)!=36 or [r.get('sp_id') for r in sp] != [f'SP{i:03d}' for i in range(1,37)]: err('SP001-SP036 authority not exact')

checks=[('SEMANTIC_REVIEW_REGISTER.csv',510),('FLOW_STATE_REVIEW_REGISTER.csv',510),('BENCHMARK_RELEVANCE_REVIEW.csv',510)]
for name,n in checks:
    x=rows(R/name)
    if len(x)!=n or any((r.get('review_status') or '').upper()!='APPROVED' for r in x): err(f'{name} prerequisite is not 510/510 APPROVED')

for name,n in [('ARCHITECTURE_STACK_REGISTER.csv',15),('ARCHITECTURE_DECISION_REGISTER.csv',36),('ARCHITECTURE_COMPONENT_PLACEMENT.csv',26),('FEATURE_ARCHITECTURE_PLACEMENT.csv',510),('EXPERIENCE_KERNEL_REGISTER.csv',36),('AI_IMPLEMENTATION_CONTROL_REGISTER.csv',15)]:
    x=rows(R/name)
    if len(x)!=n: err(f'{name}: rows={len(x)}, expected {n}')
    if x and 'review_status' in x[0] and any((r.get('review_status') or '').upper()!='APPROVED' for r in x): err(f'{name}: not all rows APPROVED')

fp=rows(R/'FEATURE_ARCHITECTURE_PLACEMENT.csv')
if fp and [r.get('feature_id') for r in fp] != [f'F{i:03d}' for i in range(1,511)]: err('FEATURE_ARCHITECTURE_PLACEMENT IDs mismatch')
rev=rows(R/'ARCHITECTURE_AI_FREEZE_REVIEW.csv')
if len(rev)!=1 or (rev[0].get('review_status') or '').upper()!='APPROVED': err('ARCHITECTURE_AI_FREEZE_REVIEW is not APPROVED')

required_docs=[
'00-program/FINAL_PASS_E_ARCHITECTURE_AI_FREEZE.md','00-program/AI_ENGINEERING_EXECUTION_PROTOCOL.md','00-program/TECHNICAL_IMPLEMENTATION_WAVES.md','00-program/DEPLOYMENT_ENVIRONMENT_PLAN.md',
'01-standards/TECH_STACK_ADR.md','01-standards/PROJECT_STRUCTURE_CONSTITUTION.md','01-standards/WRITE_OPERATION_CONSTITUTION.md','01-standards/DATABASE_CONSTITUTION.md','01-standards/API_COMMAND_QUERY_STANDARD.md','01-standards/CROSS_MODULE_OWNERSHIP_STANDARD.md','01-standards/MOBILE_OFFLINE_STANDARD.md','01-standards/NON_FUNCTIONAL_BUDGETS.md','01-standards/SECURITY_THREAT_MODEL.md','01-standards/EXPERIENCE_KERNEL_STANDARD.md','01-standards/ASYNC_EVENT_WORKER_STANDARD.md','01-standards/AI_RUNTIME_GOVERNANCE_STANDARD.md','01-standards/DEPLOYMENT_DR_RELEASE_STANDARD.md']
for rel in required_docs:
    if not (D/rel).exists(): err('missing '+rel)

paths=['apps/web/src/app','apps/web/src/core','apps/web/src/modules','apps/web/src/shared','apps/mobile/src/app','apps/mobile/src/core','apps/mobile/src/modules','apps/mobile/src/shared','services/api/src/core','services/api/src/modules','services/api/src/orchestration','services/worker','packages','database/platform','database/tenant','tests/integration','tests/security','scripts/validation']
for p in paths:
    if not (ROOT/p).exists(): err('frozen repository boundary missing: '+p)

# Frozen stack must still describe the actual repository-pinned packages.
try:
    rp=json.loads((ROOT/'package.json').read_text(encoding='utf-8')); wp=json.loads((ROOT/'apps/web/package.json').read_text(encoding='utf-8')); mp=json.loads((ROOT/'apps/mobile/package.json').read_text(encoding='utf-8'))
    actual={'Node.js':rp.get('engines',{}).get('node',''),'pnpm':rp.get('packageManager',''),'Next.js':wp.get('dependencies',{}).get('next',''),'React':wp.get('dependencies',{}).get('react',''),'Zod':wp.get('dependencies',{}).get('zod',''),'pg':wp.get('dependencies',{}).get('pg',''),'Expo':mp.get('dependencies',{}).get('expo',''),'React Native':mp.get('dependencies',{}).get('react-native',''),'TanStack Query':mp.get('dependencies',{}).get('@tanstack/react-query','')}
    sr={r['technology']:r['version'] for r in rows(R/'ARCHITECTURE_STACK_REGISTER.csv')}
    for k,v in actual.items():
        if sr.get(k)!=v: err(f'stack drift for {k}: frozen={sr.get(k)!r}, actual={v!r}')
except Exception as e: err('stack verification failed: '+str(e))

semantic_docs={
'01-standards/WRITE_OPERATION_CONSTITUTION.md':['begin transaction','tenant/rls context','same checked-out client','idempotency','audit','outbox/event','rollback'],
'01-standards/DATABASE_CONSTITUTION.md':['numeric','bigint','effective dating','rls','migrations'],
'01-standards/ASYNC_EVENT_WORKER_STANDARD.md':['trusted persisted','idempotency','retry','dead-letter','reconciliation'],
'01-standards/AI_RUNTIME_GOVERNANCE_STANDARD.md':['never writes erp business tables directly','authorized context','provenance','kill-switch','deterministic'],
'01-standards/EXPERIENCE_KERNEL_STANDARD.md':['loading','empty','error','conflict','offline','wcag 2.2 aa'],
'00-program/AI_ENGINEERING_EXECUTION_PROTOCOL.md':['load authority','audit repository','implementation manifest','database/invariants','adversarial review','evidence packet'],
}
for rel,tokens in semantic_docs.items():
    p=D/rel
    if not p.exists(): continue
    txt=p.read_text(encoding='utf-8').lower()
    for tok in tokens:
        if tok not in txt: err(f'{rel}: missing semantic token {tok}')

# Pass E docs cannot invent canonical business IDs > F510.
for rel in required_docs:
    p=D/rel
    if not p.exists(): continue
    for x in re.findall(r'\bF(\d{3,})\b',p.read_text(encoding='utf-8')):
        if int(x)>510: err(f'{rel}: invented F{x}')

if errors:
    print('FINAL PASS E ARCHITECTURE + AI FREEZE VALIDATION FAILED')
    for x in errors[:120]: print(' -',x)
    sys.exit(1)
print('FINAL PASS E ARCHITECTURE + AI FREEZE VALIDATION PASSED')
print(' - canonical F001-F510 and SP001-SP036 authority preserved')
print(' - architecture decisions: 36 / 36 APPROVED')
print(' - project/source placement rules: 26')
print(' - feature architecture placements: 510 / 510')
print(' - Experience Kernel components: 36')
print(' - AI implementation controls: 15')
print(' - request-scoped transaction/RLS, deterministic truth, worker, offline, DR and AI boundaries: PASS')
print(' - product implementation/readiness promotion: NONE')
