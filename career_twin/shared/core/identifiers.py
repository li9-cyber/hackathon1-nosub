"""Stable IDs shared across current and legacy workflows.

The encoding is a persistence contract: changing it would invalidate evidence,
canonical skill links, caches and stored project references.
"""
import hashlib
import json
from uuid import uuid4


def uid(prefix):
    return prefix + "_" + uuid4().hex


def stable_id(prefix, *parts):
    return prefix + "_" + hashlib.sha256(json.dumps(parts, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:20]
