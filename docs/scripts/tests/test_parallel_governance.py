#!/usr/bin/env python3
from __future__ import annotations
import csv
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SCRIPT_DIR = Path(__file__).resolve().parents[1]
PARALLEL = SCRIPT_DIR / "validate_parallel_implementation.py"
SCOPE = SCRIPT_DIR / "validate_agent_scope.py"
WAVES = ["T00", "T01"] + [f"W{i:02d}" for i in range(1, 16)]
DEPS = {
    "T00": [], "T01": ["T00"], "W01": ["T00", "T01"], "W02": ["T00", "T01", "W01"],
    "W03": ["T01", "W01"], "W04": ["W01", "W02", "W03"], "W05": ["W01", "W02"],
    "W06": ["W02", "W04", "W05"], "W07": ["W05", "W06"], "W08": ["W04", "W05", "W06"],
    "W09": ["W01", "W02", "W06"], "W10": ["W03", "W04", "W08"], "W11": ["T01", "W06"],
    "W12": ["W03", "W04", "W05", "W06", "W07", "W08", "W09", "W10", "W11"],
    "W13": ["W12"], "W14": ["W12", "W13"], "W15": ["W14"],
}

def write_csv(path: Path, fields, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(data)

def read_csv(path: Path):
    with path.open(encoding="utf-8", newline="") as f: return list(csv.DictReader(f))

def replace_csv(path: Path, rows):
    fields = list(rows[0].keys()) if rows else []
    write_csv(path, fields, rows)

def git(root: Path, *args: str):
    return subprocess.run(["git", *args], cwd=root, text=True, capture_output=True, check=True).stdout.strip()

class Fixture:
    def __init__(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        r = self.root/"docs/02-register"; p = self.root/"docs/08-implementation-plans"
        wave_rows=[]; mirror=[]; exec_rows=[]
        for wid in WAVES:
            dep="W03-W11" if wid=="W12" else (";".join(DEPS[wid]) if DEPS[wid] else "None")
            wave_rows.append({"wave_id":wid,"name":wid,"scope":"scope","depends_on":dep,"planning_status":"PLANNED_FROZEN","implementation_authority":"PASS_F_AUTHORIZED_WHEN_PREDECESSORS_PASS"})
            mirror.append({"wave_id":wid,"name":wid,"scope":"scope","depends_on":dep,"exit_gate":"gate","accountable_owner":"Project Manager","planning_status":"PLANNED_FROZEN","calendar_timeline_policy":"NO_CALENDAR_TIMELINE_BASELINED"})
            exec_rows.append({"wave_id":wid,"execution_status":"RECONCILIATION_REQUIRED","predecessor_evidence_status":"RECONCILIATION_REQUIRED","exit_gate_status":"NOT_EVALUATED","active_work_packages":"","last_verified_commit":"","evidence_path":"","blockers":"reconcile","accountable_owner":"Project Manager"})
        write_csv(r/"IMPLEMENTATION_WAVE_REGISTER.csv", wave_rows[0].keys(), wave_rows)
        write_csv(p/"IMPLEMENTATION_WAVES.csv", mirror[0].keys(), mirror)
        features=[]; manifests=[]
        for i in range(1,511):
            fid=f"F{i:03d}"; wave="W03" if i<=30 else "W04" if i<=62 else "W05" if i<=144 else "W07" if i<=192 else "W08" if i<=267 else "W09" if i<=307 else "W07" if i<=342 else "W10" if i<=380 else "W11" if i<=452 else "W06"
            features.append({"feature_id":fid,"feature_name":fid,"module":"M","primary_wave":wave,"canonical_wave_dependencies":";".join(DEPS[wave]),"implementation_order_rule":"DEPENDENCY_GRAPH_BEFORE_NUMERIC_F_ID_ORDER","authorization":"AUTHORIZED","status":"FROZEN"})
            manifests.append({"feature_id":fid,"primary_wave":wave})
        write_csv(r/"FEATURE_IMPLEMENTATION_WAVE_REGISTER.csv", features[0].keys(), features)
        write_csv(r/"FEATURE_BUILD_MANIFEST.csv", manifests[0].keys(), manifests)
        write_csv(r/"IMPLEMENTATION_EXECUTION_REGISTER.csv", exec_rows[0].keys(), exec_rows)
        awp_fields=["work_package_id","canonical_wave","work_type","title","feature_ids","depends_on_work_packages","accountable_owner","executor_class","base_commit","branch","owned_paths","forbidden_paths","shared_change_required","requires_migration","migration_reservations","touches_ui","required_verification","status","evidence_path"]
        write_csv(r/"AGENT_WORK_PACKAGE_REGISTER.csv", awp_fields, [])
        mig_fields=["reservation_id","database_scope","prefix","work_package_id","status","migration_filename","accountable_owner","notes"]
        write_csv(r/"MIGRATION_RESERVATION_REGISTER.csv", mig_fields, [])
        (p/"W03_F001_LEADS_IMPLEMENTATION.md").write_text("# W03 / F001 — Leads Implementation\n", encoding="utf-8")
        (self.root/"database/platform/migrations").mkdir(parents=True)
        (self.root/"database/tenant/migrations").mkdir(parents=True)
        git(self.root,"init","-q"); git(self.root,"config","user.email","test@example.com"); git(self.root,"config","user.name","Test")
        git(self.root,"add","."); git(self.root,"commit","-qm","fixture")
        self.base=git(self.root,"rev-parse","HEAD")
    def close(self): self.tmp.cleanup()
    def awp(self, pid="AWP-W03-F001-01", wave="W03", status="ACTIVE", branch="awp/w03-f001-01", owned="services/api/src/modules/crm/leads", feature="F001", requires_migration="NO", reservations="", work_type="FEATURE", deps=""):
        p=self.root/"docs/02-register/AGENT_WORK_PACKAGE_REGISTER.csv"; rows_=read_csv(p)
        rows_.append({"work_package_id":pid,"canonical_wave":wave,"work_type":work_type,"title":pid,"feature_ids":feature,"depends_on_work_packages":deps,"accountable_owner":"Project Manager","executor_class":"AI_AGENT","base_commit":self.base,"branch":branch,"owned_paths":owned,"forbidden_paths":"","shared_change_required":"NO","requires_migration":requires_migration,"migration_reservations":reservations,"touches_ui":"NO","required_verification":"test","status":status,"evidence_path":"evidence.md"})
        replace_csv(p, rows_)
        if status in {"ACTIVE","READY_FOR_INTEGRATION"} and wave in WAVES:
            ep=self.root/"docs/02-register/IMPLEMENTATION_EXECUTION_REGISTER.csv"; ers=read_csv(ep)
            for er in ers:
                if er["wave_id"]==wave:
                    vals=[x for x in er["active_work_packages"].split(";") if x]
                    vals.append(pid); er["active_work_packages"]=";".join(vals)
            replace_csv(ep,ers)
    def pass_predecessors(self, wave="W03"):
        p=self.root/"docs/02-register/IMPLEMENTATION_EXECUTION_REGISTER.csv"; rs=read_csv(p)
        for r in rs:
            if r["wave_id"] in DEPS[wave]: r["exit_gate_status"]="PASS"
        replace_csv(p,rs)
    def set_wave_in_progress(self, wave="W03"):
        p=self.root/"docs/02-register/IMPLEMENTATION_EXECUTION_REGISTER.csv"; rs=read_csv(p)
        for r in rs:
            if r["wave_id"]==wave:
                r["execution_status"]="IN_PROGRESS"; r["predecessor_evidence_status"]="PASS"; r["exit_gate_status"]="PENDING"
        replace_csv(p,rs)
    def run_parallel(self): return subprocess.run(["python",str(PARALLEL),"--root",str(self.root)],text=True,capture_output=True)

class ParallelGovernanceNegativeTests(unittest.TestCase):
    def setUp(self): self.fx=Fixture()
    def tearDown(self): self.fx.close()
    def assertFails(self, needle):
        r=self.fx.run_parallel(); self.assertNotEqual(r.returncode,0,r.stdout+r.stderr); self.assertIn(needle,r.stdout+r.stderr)
    def active_pair(self, owned1, owned2, branch2="awp/w03-f002-01"):
        self.fx.pass_predecessors(); self.fx.awp(owned=owned1); self.fx.awp(pid="AWP-W03-F002-01",feature="F002",owned=owned2,branch=branch2)
    def test_01_same_owned_path_collision(self): self.active_pair("services/api/src/modules/crm/leads","services/api/src/modules/crm/leads"); self.assertFails("owned-path collision")
    def test_02_parent_child_owned_path_collision(self): self.active_pair("services/api/src/modules/crm","services/api/src/modules/crm/leads"); self.assertFails("owned-path collision")
    def test_03_unmet_canonical_predecessor(self): self.fx.awp(); self.assertFails("canonical predecessor")
    def test_04_duplicate_active_branch(self): self.active_pair("a","b",branch2="awp/w03-f001-01"); self.assertFails("duplicate active branch")
    def test_05_duplicate_work_package_id(self): self.fx.pass_predecessors(); self.fx.awp(); self.fx.awp(); self.assertFails("duplicate work-package ID")
    def test_06_invalid_wave(self): self.fx.awp(wave="W99"); self.assertFails("invalid canonical_wave W99")
    def test_07_feature_belongs_to_another_wave(self): self.fx.pass_predecessors(); self.fx.awp(feature="F031"); self.assertFails("feature F031 belongs to W04")
    def test_08_duplicate_migration_prefix(self):
        self.fx.pass_predecessors(); self.fx.awp(requires_migration="YES",reservations="MR-1;MR-2")
        p=self.fx.root/"docs/02-register/MIGRATION_RESERVATION_REGISTER.csv"
        rows_=[{"reservation_id":"MR-1","database_scope":"TENANT","prefix":"900","work_package_id":"AWP-W03-F001-01","status":"RESERVED","migration_filename":"","accountable_owner":"Project Manager","notes":""},{"reservation_id":"MR-2","database_scope":"TENANT","prefix":"900","work_package_id":"AWP-W03-F001-01","status":"RESERVED","migration_filename":"","accountable_owner":"Project Manager","notes":""}]
        write_csv(p,rows_[0].keys(),rows_); self.assertFails("duplicate active migration prefix")
    def test_09_reserved_prefix_already_exists(self):
        self.fx.pass_predecessors(); self.fx.awp(requires_migration="YES",reservations="MR-1")
        p=self.fx.root/"docs/02-register/MIGRATION_RESERVATION_REGISTER.csv"; row={"reservation_id":"MR-1","database_scope":"TENANT","prefix":"900","work_package_id":"AWP-W03-F001-01","status":"RESERVED","migration_filename":"","accountable_owner":"Project Manager","notes":""}; write_csv(p,row.keys(),[row]); (self.fx.root/"database/tenant/migrations/900_conflict.sql").write_text("-- x\n"); self.assertFails("already exists on disk")
    def test_10_requires_migration_without_reservation(self): self.fx.pass_predecessors(); self.fx.awp(requires_migration="YES"); self.assertFails("requires_migration=YES without reservation")
    def test_14_plain_wave_one_naming(self): (self.fx.root/"docs/08-implementation-plans/WAVE_1_BAD.md").write_text("# Wave 1 bad\n"); self.assertFails("ambiguous implementation-plan filename")

    def test_15_case_only_owned_paths_collide(self):
        self.active_pair("Services/API/src/modules/crm/leads", "services/api/src/modules/crm/leads")
        self.assertFails("owned-path collision")

    def test_16_noncanonical_numeric_migration_prefix_is_rejected(self):
        self.fx.pass_predecessors(); self.fx.awp(requires_migration="YES", reservations="MR-1")
        p=self.fx.root/"docs/02-register/MIGRATION_RESERVATION_REGISTER.csv"
        row={"reservation_id":"MR-1","database_scope":"TENANT","prefix":"74","work_package_id":"AWP-W03-F001-01","status":"RESERVED","migration_filename":"","accountable_owner":"Project Manager","notes":""}
        write_csv(p,row.keys(),[row]); self.assertFails("canonical zero-padded form 074")

    def test_17_released_reservation_cannot_back_active_package(self):
        self.fx.pass_predecessors(); self.fx.awp(requires_migration="YES", reservations="MR-1")
        p=self.fx.root/"docs/02-register/MIGRATION_RESERVATION_REGISTER.csv"
        row={"reservation_id":"MR-1","database_scope":"TENANT","prefix":"900","work_package_id":"AWP-W03-F001-01","status":"RELEASED","migration_filename":"","accountable_owner":"Project Manager","notes":""}
        write_csv(p,row.keys(),[row]); self.assertFails("is not usable in status RELEASED")

    def test_18_execution_register_cannot_list_closed_package_as_active(self):
        self.fx.awp(status="CLOSED")
        ep=self.fx.root/"docs/02-register/IMPLEMENTATION_EXECUTION_REGISTER.csv"; ers=read_csv(ep)
        for er in ers:
            if er["wave_id"]=="W03": er["active_work_packages"]="AWP-W03-F001-01"
        replace_csv(ep,ers); self.assertFails("stale/non-active package")

    def test_19_unsafe_parent_traversal_owned_path_is_rejected(self):
        self.fx.pass_predecessors(); self.fx.awp(owned="services/api/../docs")
        self.assertFails("unsafe/non-prefix repository path")

    def test_20_consumed_reservation_requires_filename(self):
        self.fx.pass_predecessors(); self.fx.awp(requires_migration="YES", reservations="MR-1")
        mig=self.fx.root/"database/tenant/migrations/900_test.sql"; mig.write_text("-- test\n",encoding="utf-8")
        p=self.fx.root/"docs/02-register/MIGRATION_RESERVATION_REGISTER.csv"
        row={"reservation_id":"MR-1","database_scope":"TENANT","prefix":"900","work_package_id":"AWP-W03-F001-01","status":"CONSUMED","migration_filename":"","accountable_owner":"Project Manager","notes":""}
        write_csv(p,row.keys(),[row]); self.assertFails("CONSUMED reservation requires migration_filename")

    def test_21_feature_register_requires_exact_f001_f510_set(self):
        p=self.fx.root/"docs/02-register/FEATURE_IMPLEMENTATION_WAVE_REGISTER.csv"; rs=read_csv(p); rs[-1]["feature_id"]="F999"; replace_csv(p,rs)
        self.assertFails("exact canonical F001-F510 ID set")

    def test_22_active_package_requires_wave_in_progress(self):
        self.fx.pass_predecessors(); self.fx.awp(); self.assertFails("execution_status IN_PROGRESS")

    def test_23_feature_package_cannot_own_shared_hot_path(self):
        self.fx.pass_predecessors(); self.fx.awp(owned="packages/ui/components"); self.assertFails("FEATURE package may not own shared hot path")

    def test_24_awp_id_wave_must_match_canonical_wave(self):
        self.fx.pass_predecessors(); self.fx.awp(pid="AWP-W04-F001-01",wave="W03"); self.assertFails("AWP ID embeds W04 but canonical_wave is W03")

    def test_25_migration_reservation_owner_remains_project_manager(self):
        self.fx.pass_predecessors(); self.fx.awp(requires_migration="YES",reservations="MR-1")
        p=self.fx.root/"docs/02-register/MIGRATION_RESERVATION_REGISTER.csv"
        row={"reservation_id":"MR-1","database_scope":"TENANT","prefix":"900","work_package_id":"AWP-W03-F001-01","status":"RESERVED","migration_filename":"","accountable_owner":"AI_AGENT","notes":""}
        write_csv(p,row.keys(),[row]); self.assertFails("accountable_owner must remain Project Manager")

    def test_26_valid_active_package_with_reconciled_wave_and_branch_passes(self):
        self.fx.pass_predecessors(); self.fx.set_wave_in_progress(); git(self.fx.root,"branch","awp/w03-f001-01",self.fx.base); self.fx.awp()
        r=self.fx.run_parallel(); self.assertEqual(r.returncode,0,r.stdout+r.stderr)

class AgentScopeNegativeTests(unittest.TestCase):
    def make(self, registered_branch="awp/w03-f001-01", base_mode="valid", owned="docs"):
        fx=Fixture(); fx.pass_predecessors(); fx.awp(branch=registered_branch,owned=owned)
        # Registration must be part of base state.
        git(fx.root,"add","."); git(fx.root,"commit","-qm","register awp"); base=git(fx.root,"rev-parse","HEAD")
        p=fx.root/"docs/02-register/AGENT_WORK_PACKAGE_REGISTER.csv"; rs=read_csv(p); rs[0]["base_commit"] = "deadbeef" if base_mode=="invalid" else base; replace_csv(p,rs)
        git(fx.root,"add",str(p.relative_to(fx.root))); git(fx.root,"commit","-qm","pin base")
        # For valid base semantics, update the registered base to its ancestor fixture commit and amend.
        if base_mode=="valid":
            pinned_parent=git(fx.root,"rev-parse","HEAD~1"); rs=read_csv(p); rs[0]["base_commit"]=pinned_parent; replace_csv(p,rs); git(fx.root,"add",str(p.relative_to(fx.root))); git(fx.root,"commit","--amend","-qm","pin base")
        return fx
    def run_scope(self,fx): return subprocess.run(["python",str(SCOPE),"AWP-W03-F001-01","--root",str(fx.root)],text=True,capture_output=True)
    def test_11_feature_package_cannot_edit_central_governance(self):
        fx=self.make(owned="docs"); self.addCleanup(fx.close); git(fx.root,"checkout","-qb","awp/w03-f001-01"); p=fx.root/"docs/02-register/IMPLEMENTATION_WAVE_REGISTER.csv"; p.write_text(p.read_text()+"\n",encoding="utf-8"); r=self.run_scope(fx); self.assertNotEqual(r.returncode,0); self.assertIn("FEATURE package may not modify central governance path",r.stdout+r.stderr)
    def test_12_current_branch_mismatch(self):
        fx=self.make(); self.addCleanup(fx.close); r=self.run_scope(fx); self.assertNotEqual(r.returncode,0); self.assertIn("current branch",r.stdout+r.stderr)
    def test_13_invalid_base_commit(self):
        fx=self.make(registered_branch="master",base_mode="invalid"); self.addCleanup(fx.close); r=self.run_scope(fx); self.assertNotEqual(r.returncode,0); self.assertIn("invalid/unrecognized",r.stdout+r.stderr)

if __name__ == "__main__": unittest.main(verbosity=2)
