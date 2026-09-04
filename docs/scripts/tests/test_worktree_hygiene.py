#!/usr/bin/env python3
from __future__ import annotations
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'validate_worktree_hygiene.py'

def git(root: Path, *args: str, check=True):
    return subprocess.run(['git', *args], cwd=root, text=True, capture_output=True, check=check)

class HygieneTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.root=Path(self.tmp.name)
        git(self.root,'init','-q'); git(self.root,'config','user.email','test@example.com'); git(self.root,'config','user.name','Test')
        (self.root/'.gitattributes').write_text('*.md text eol=lf\n*.py text eol=lf\n',encoding='utf-8',newline='\n')
        (self.root/'.gitignore').write_text('__pycache__/\n*.py[cod]\n',encoding='utf-8',newline='\n')
        (self.root/'docs').mkdir(); (self.root/'docs/a.md').write_text('ok\n',encoding='utf-8',newline='\n')
        git(self.root,'add','.'); git(self.root,'commit','-qm','base')
    def tearDown(self): self.tmp.cleanup()
    def run_validator(self):
        return subprocess.run(['python',str(SCRIPT),'--root',str(self.root),'--scope','docs'],text=True,capture_output=True)
    def test_clean_change_passes(self):
        (self.root/'docs/a.md').write_text('changed\n',encoding='utf-8',newline='\n')
        r=self.run_validator(); self.assertEqual(r.returncode,0,r.stdout+r.stderr)
    def test_staged_trailing_whitespace_fails(self):
        (self.root/'docs/a.md').write_text('bad \n',encoding='utf-8',newline='\n'); git(self.root,'add','docs/a.md')
        r=self.run_validator(); self.assertNotEqual(r.returncode,0); self.assertIn('trailing whitespace',r.stdout+r.stderr)
    def test_untracked_trailing_whitespace_fails(self):
        (self.root/'docs/new.md').write_text('bad \n',encoding='utf-8',newline='\n')
        r=self.run_validator(); self.assertNotEqual(r.returncode,0); self.assertIn('untracked file',r.stdout+r.stderr)
    def test_untracked_conflict_marker_fails(self):
        (self.root/'docs/new.md').write_text('<<<<<<< ours\ntext\n=======\nother\n>>>>>>> theirs\n',encoding='utf-8',newline='\n')
        r=self.run_validator(); self.assertNotEqual(r.returncode,0); self.assertIn('conflict marker',r.stdout+r.stderr)
    def test_untracked_blank_line_at_eof_fails(self):
        (self.root/'docs/new.md').write_text('text\n\n',encoding='utf-8',newline='\n')
        r=self.run_validator(); self.assertNotEqual(r.returncode,0); self.assertIn('blank line at EOF',r.stdout+r.stderr)
    def test_crlf_on_lf_attribute_fails(self):
        (self.root/'docs/a.md').write_bytes(b'changed\r\n')
        r=self.run_validator(); self.assertNotEqual(r.returncode,0); self.assertIn('CRLF violates repository eol=lf',r.stdout+r.stderr)
    def test_ignored_pycache_does_not_pollute_scope(self):
        p=self.root/'docs/__pycache__/x.pyc'; p.parent.mkdir(); p.write_bytes(b'\0binary')
        r=self.run_validator(); self.assertEqual(r.returncode,0,r.stdout+r.stderr)
    def test_untracked_patch_transport_artifact_is_skipped(self):
        # Unified diffs may intentionally preserve source trailing whitespace or
        # conflict-marker-looking payload. They are transport artifacts, not source.
        (self.root/'docs/review.patch').write_bytes(b'--- a/x\n+++ b/x\n+bad \n+<<<<<<< payload\n')
        r=self.run_validator(); self.assertEqual(r.returncode,0,r.stdout+r.stderr)
        self.assertIn('patch/diff transport artifacts skipped: 1',r.stdout+r.stderr)
    def test_untracked_diff_transport_artifact_is_skipped(self):
        (self.root/'docs/review.diff').write_bytes(b'diff --git a/x b/x\n+bad \n')
        r=self.run_validator(); self.assertEqual(r.returncode,0,r.stdout+r.stderr)
    def test_untracked_nontransport_text_still_fails(self):
        (self.root/'docs/review.txt').write_text('bad \n',encoding='utf-8',newline='\n')
        r=self.run_validator(); self.assertNotEqual(r.returncode,0); self.assertIn('trailing whitespace',r.stdout+r.stderr)

if __name__=='__main__': unittest.main(verbosity=2)
