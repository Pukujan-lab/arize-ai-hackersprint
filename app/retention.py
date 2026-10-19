"""Bounded stores, first in first out.

Saved runs and the queued trace spans both have a hard cap. At the cap the oldest entry is dropped first,
and the figures `/api/stack` reports describe the store after that pruning, never before it.
"""

import os
import pathlib
import shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
RUNS = ROOT / "runs"
RUNS_KEPT = int(os.environ.get("RUNS_KEPT", "200"))


def run_dirs():
    """Every run directory on disk, oldest name-independent (ordering is by mtime where it matters)."""
    if not RUNS.exists():
        return []
    return [d for d in RUNS.iterdir() if d.is_dir() and not d.name.startswith(".")]


def prune_runs(keep=None):
    """Remove the oldest run directories until at most RUNS_KEPT remain. Returns the count left on disk."""
    dirs = run_dirs()
    excess = len(dirs) - RUNS_KEPT
    if excess <= 0:
        return len(dirs)

    def modified(directory):
        try:
            return directory.stat().st_mtime
        except OSError:
            return 0.0

    protected = {keep} if keep else set()
    for directory in sorted(dirs, key=modified):  # oldest first
        if excess <= 0:
            break
        if directory.name in protected:
            continue
        shutil.rmtree(directory, ignore_errors=True)
        excess -= 1
    return len(run_dirs())
