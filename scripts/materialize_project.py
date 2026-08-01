#!/usr/bin/env python3
"""Materialize the initial source tree from connector-friendly bootstrap chunks."""

from __future__ import annotations

import base64
import hashlib
import io
import shutil
import tarfile
from pathlib import Path

EXPECTED_SHA256 = "cb58c4619d43a06abfe47c3c225d0b0fb3405b1cf1a55d78f9dabbc898a51491"

root = Path(__file__).resolve().parents[1]
bootstrap_dir = root / ".bootstrap"
parts = sorted(bootstrap_dir.glob("part*"))
if not parts:
    raise RuntimeError("No bootstrap parts found")

encoded = "".join(part.read_text(encoding="utf-8").strip() for part in parts)
payload = base64.b64decode(encoded, validate=True)
actual_sha256 = hashlib.sha256(payload).hexdigest()
if actual_sha256 != EXPECTED_SHA256:
    raise RuntimeError(
        f"Bootstrap archive checksum mismatch: {actual_sha256} != {EXPECTED_SHA256}"
    )

with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
    for member in archive.getmembers():
        target = (root / member.name).resolve()
        if target != root and root not in target.parents:
            raise RuntimeError(f"Unsafe archive member: {member.name}")
    archive.extractall(root, filter="data")

# setup-node's npm cache requires a lockfile. The project intentionally starts
# without one, so keep CI portable until the first dependency update creates it.
ci_path = root / ".github" / "workflows" / "ci.yml"
if ci_path.exists():
    ci_text = ci_path.read_text(encoding="utf-8")
    ci_path.write_text(ci_text.replace("          cache: npm\n", ""), encoding="utf-8")

shutil.rmtree(bootstrap_dir)
print(f"Materialized {len(payload)} bytes from {len(parts)} verified chunks")
