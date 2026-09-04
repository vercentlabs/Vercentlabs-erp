#!/usr/bin/env python3
from pathlib import Path
import csv, hashlib, subprocess, sys
ROOT=Path(__file__).resolve().parents[2];D=ROOT/'docs';R=D/'02-register';errors=[]
def err(x): errors.append(x)
def csvrows(p):
    with p.open(encoding='utf-8',newline='') as f:return list(csv.DictReader(f))

required=[
 D/'00-program/FINAL_TECHNICAL_EXECUTION_BLUEPRINT.md',D/'00-program/AI_ENGINEERING_EXECUTION_PROTOCOL.md',
 D/'00-program/MASTER_TRACEABILITY_MODEL.md',D/'00-program/TECHNICAL_IMPLEMENTATION_WAVES.md',
 D/'00-program/DEPLOYMENT_ENVIRONMENT_PLAN.md',D/'00-program/MIGRATION_RECONCILIATION_STANDARD.md',
 D/'00-program/FINAL_PLANNING_FINISH_LINE.md',D/'00-program/PARALLEL_AI_IMPLEMENTATION_OPERATING_MODEL.md',
 R/'IMPLEMENTATION_EXECUTION_REGISTER.csv',R/'AGENT_WORK_PACKAGE_REGISTER.csv',R/'MIGRATION_RESERVATION_REGISTER.csv',
 D/'01-standards/TECH_STACK_ADR.md',D/'01-standards/PROJECT_STRUCTURE_CONSTITUTION.md',
 D/'01-standards/WRITE_OPERATION_CONSTITUTION.md',D/'01-standards/DATABASE_CONSTITUTION.md',
 D/'01-standards/API_COMMAND_QUERY_STANDARD.md',D/'01-standards/CROSS_MODULE_OWNERSHIP_STANDARD.md',
 D/'01-standards/MOBILE_OFFLINE_STANDARD.md',D/'01-standards/NON_FUNCTIONAL_BUDGETS.md',
 D/'01-standards/SECURITY_THREAT_MODEL.md',R/'FEATURE_BUILD_MANIFEST.csv',R/'TRACEABILITY_GRAPH.csv',
 R/'SEMANTIC_REVIEW_REGISTER.csv',R/'BENCHMARK_RELEVANCE_REVIEW.csv'
]
for p in required:
    if not p.exists(): err('missing '+str(p.relative_to(ROOT)))

fr=csvrows(R/'FEATURE_REGISTER.csv')
if len(fr)!=510: err(f'FEATURE_REGISTER rows={len(fr)}, expected 510')
ids=[r.get('feature_id') for r in fr]
if ids!=[f'F{i:03d}' for i in range(1,511)]: err('feature IDs are not exactly F001-F510')
sha=hashlib.sha256(''.join(f"{r['feature_id']},{r['feature_name']}\n" for r in fr).encode()).hexdigest()
if sha!='82cfcf68e74cef8c8c8872136d0bfcc0bb619b0517f3a33cfc92bc1e3dde232e': err('canonical fingerprint mismatch')

if (R/'FEATURE_BUILD_MANIFEST.csv').exists():
    m=csvrows(R/'FEATURE_BUILD_MANIFEST.csv')
    if len(m)!=510: err(f'FEATURE_BUILD_MANIFEST rows={len(m)}, expected 510')
    if [r['feature_id'] for r in m]!=[f'F{i:03d}' for i in range(1,511)]: err('FEATURE_BUILD_MANIFEST IDs mismatch')

if (R/'SEMANTIC_REVIEW_REGISTER.csv').exists() and len(csvrows(R/'SEMANTIC_REVIEW_REGISTER.csv'))!=510: err('SEMANTIC_REVIEW_REGISTER must contain 510 rows')
if (R/'BENCHMARK_RELEVANCE_REVIEW.csv').exists() and len(csvrows(R/'BENCHMARK_RELEVANCE_REVIEW.csv'))!=510: err('BENCHMARK_RELEVANCE_REVIEW must contain 510 rows')

# No new canonical F-IDs may appear in the final-blueprint artifacts.
for p in required:
    if p.suffix=='.md' and p.exists():
        t=p.read_text(encoding='utf-8')
        import re
        bad=[x for x in re.findall(r'\bF(\d{3,})\b',t) if int(x)>510]
        if bad: err(f'{p.name}: invented canonical-looking F-ID above 510')

# Constitution semantic tokens catch accidental empty/template replacement.
checks={
 'WRITE_OPERATION_CONSTITUTION.md':['authenticate','transaction','rls','idempotency','audit','outbox','rollback'],
 'DATABASE_CONSTITUTION.md':['numeric','money','uom','effective','migration','rls'],
 'AI_ENGINEERING_EXECUTION_PROTOCOL.md':['load authority','audit repository','implementation manifest','adversarial review','evidence packet'],
 'PROJECT_STRUCTURE_CONSTITUTION.md':['services/api/src/modules','services/api/src/orchestration','f-ids'],
}
for name,tokens in checks.items():
    p=(D/'01-standards'/name) if (D/'01-standards'/name).exists() else (D/'00-program'/name)
    if not p.exists(): continue
    txt=p.read_text(encoding='utf-8').lower()
    for token in tokens:
        if token not in txt: err(f'{name}: missing semantic token {token}')


parallel=subprocess.run([sys.executable,str(D/'scripts/validate_parallel_implementation.py')],cwd=ROOT,text=True,capture_output=True)
if parallel.returncode!=0: err('parallel governance validation failed: '+(parallel.stdout+parallel.stderr).strip().replace('\n',' | '))

if errors:
    print('FINAL TECHNICAL BLUEPRINT VALIDATION FAILED')
    for x in errors[:100]: print(' -',x)
    sys.exit(1)
print('FINAL TECHNICAL BLUEPRINT VALIDATION PASSED')
print(' - canonical F001-F510 fingerprint preserved')
print(' - project structure / tech stack / write / DB / API / module ownership standards present')
print(' - AI engineering protocol and implementation waves present')
print(' - 510-row build and semantic/benchmark review manifests present')
print(' - requirement-level traceability graph present')
print(' - parallel AWP/execution/migration governance authority validated')
