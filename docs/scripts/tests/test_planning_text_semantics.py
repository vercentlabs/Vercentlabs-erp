#!/usr/bin/env python3
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "docs" / "scripts"))
from parallel_governance_lib import (
    checkpoint_has_stale_begin_t00_authorization,
    planning_closure_is_complete,
)

class PlanningTextSemanticsTests(unittest.TestCase):
    def test_current_closure_wording_is_accepted(self):
        self.assertTrue(planning_closure_is_complete("# Planning Closure Status\n\nPlanning remains **COMPLETE** for dependency-aware implementation entry.\n"))
        self.assertTrue(planning_closure_is_complete("Planning is **COMPLETE** for implementation entry.\n"))

    def test_non_complete_closure_is_rejected(self):
        self.assertFalse(planning_closure_is_complete("Planning is **IN PROGRESS**.\n"))

    def test_actual_legacy_begin_t00_instruction_is_rejected(self):
        self.assertTrue(checkpoint_has_stale_begin_t00_authorization("## Next authorized action\nBegin `T00` only when the Project Manager chooses to begin.\n"))
        self.assertTrue(checkpoint_has_stale_begin_t00_authorization("T00_WHEN_PROJECT_MANAGER_CHOOSES_TO_BEGIN"))

    def test_negated_begin_t00_reference_is_not_rejected(self):
        current = 'Current runtime wave state is **RECONCILIATION_REQUIRED**, not "Begin T00" and not an inferred COMPLETE state.'
        self.assertFalse(checkpoint_has_stale_begin_t00_authorization(current))


if __name__ == "__main__":
    unittest.main(verbosity=2)
