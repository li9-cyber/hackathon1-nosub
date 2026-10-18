"""Build context allowlist. Never uploads .env, DBs, test samples or credentials."""
import json
import hashlib
import shutil
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def stage(destination):
    target=(ROOT/destination).resolve()
    if not target.is_relative_to(ROOT/'.test-runs') or target.exists():raise ValueError('Use a new workspace .test-runs directory')
    files=[ROOT/n for n in ('main.py','run.py','requirements.txt','Dockerfile','.dockerignore')]
    files+=list((ROOT/'career_twin').rglob('*.py'))
    files+=[p for p in (ROOT/'career_twin/web').rglob('*') if p.is_file()]
    files+=list((ROOT/'career_twin/shared/matching/data').glob('*.json'))
    files+=list((ROOT/'career_twin/interview/runtime/seed').glob('*.wav'))
    files+=list((ROOT/'third_party').rglob('LICENSE*')) if (ROOT/'third_party').exists() else []
    manifest={}
    for source in files:
        relative=source.relative_to(ROOT)
        if '__pycache__' in relative.parts or source.is_symlink():continue
        dest=target/relative;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,dest)
        manifest[relative.as_posix()]=hashlib.sha256(dest.read_bytes()).hexdigest()
    target.with_suffix('.manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    return {'path':str(target),'files':len(manifest)}

if __name__=='__main__':
    import sys
    print(json.dumps(stage(sys.argv[1])))
