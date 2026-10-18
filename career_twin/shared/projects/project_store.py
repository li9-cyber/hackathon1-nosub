"""Local workspace persistence. All reads/writes are owner AND project scoped.

Career state and UI drafts use separate compare-and-swap revisions. SQLite is
deliberately separate from the shared Cloud SQL requirements catalog.
"""
import json
import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from career_twin.shared.core.config import ROOT
from career_twin.shared.core.errors import AppError


def data_dir():
    return Path(os.getenv('CAREER_PROJECT_DATA_DIR', str(ROOT / '.local-data' / 'projects')))


def now():
    return datetime.now(timezone.utc).isoformat(timespec='microseconds')


def conflict():
    return AppError('project_conflict', '專案已在另一個操作中更新。請重新開啟專案後再試；已保存資料不會被覆寫。', 409)


class ProjectStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS projects (
                    owner TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL, state TEXT, state_version INTEGER NOT NULL DEFAULT 0,
                    ui TEXT NOT NULL DEFAULT '{}', ui_revision INTEGER NOT NULL DEFAULT 0,
                    imports TEXT NOT NULL DEFAULT '[]', PRIMARY KEY(owner,id));
                CREATE TABLE IF NOT EXISTS project_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL,
                    project_id TEXT NOT NULL, created_at TEXT NOT NULL, kind TEXT NOT NULL,
                    detail TEXT NOT NULL, document_id TEXT);
                CREATE INDEX IF NOT EXISTS project_history_scope ON project_history(owner,project_id,id);
                CREATE TABLE IF NOT EXISTS cv_files (
                    owner TEXT NOT NULL, project_id TEXT NOT NULL, document_id TEXT NOT NULL,
                    filename TEXT NOT NULL, content BLOB NOT NULL,
                    PRIMARY KEY(owner,project_id,document_id));
            ''')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def decode(row):
        result = dict(row)
        result.pop('owner', None)
        for key in ('state', 'ui', 'imports'):
            result[key] = json.loads(result[key]) if result[key] else None
        return result

    def get(self, owner, project_id, *, active=False, db=None):
        if db is None:
            with self.connect() as connection:
                return self.get(owner, project_id, active=active, db=connection)
        row = db.execute('SELECT * FROM projects WHERE owner=? AND id=?', (owner, project_id)).fetchone()
        if row is None:
            raise AppError('project_missing', '找不到此專案。', 404)
        if active and row['status'] != 'active':
            raise AppError('project_archived', '此專案已封存，請先還原。', 409)
        return self.decode(row)

    def list(self, owner):
        with self.connect() as db:
            projects = [self.decode(r) for r in db.execute('SELECT * FROM projects WHERE owner=? ORDER BY updated_at DESC,id', (owner,))]
        for p in projects:
            state = p.pop('state') or {}
            p.pop('ui')
            p['summary'] = {'has_cv': bool(state), 'confirmed': sum(i['review'] == 'confirmed' for i in state.get('items', [])),
                            'jobs': len(state.get('jobs', [])), 'plans': len(state.get('plans', [])), 'versions': len(state.get('tailored', []))}
        return projects

    def event(self, db, owner, project_id, kind, detail, document_id=None):
        db.execute('INSERT INTO project_history(owner,project_id,created_at,kind,detail,document_id) VALUES(?,?,?,?,?,?)',
                   (owner, project_id, now(), kind, json.dumps(detail, ensure_ascii=False), document_id))

    def create(self, owner, name, state=None, imports=None):
        project_id, timestamp = secrets.token_hex(16), now()
        with self.connect() as db:
            db.execute('INSERT INTO projects(owner,id,name,created_at,updated_at,state,imports) VALUES(?,?,?,?,?,?,?)',
                       (owner, project_id, name, timestamp, timestamp, json.dumps(state, ensure_ascii=False) if state else None, json.dumps(imports or [], ensure_ascii=False)))
            self.event(db, owner, project_id, 'created', {'imported': bool(imports)})
        return self.get(owner, project_id)

    def update(self, owner, project_id, *, name=None, status=None):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            p = self.get(owner, project_id, db=db)
            db.execute('UPDATE projects SET name=?,status=?,updated_at=?,state_version=state_version+1 WHERE owner=? AND id=?',
                       (name or p['name'], status or p['status'], now(), owner, project_id))
            self.event(db, owner, project_id, 'renamed' if name else status, {'name': name} if name else {})
        return self.get(owner, project_id)

    def save_state(self, owner, project_id, version, state, kind):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if state['document'].get('file_name'):
                stored = db.execute('SELECT filename,length(content) AS size FROM cv_files WHERE owner=? AND project_id=? AND document_id=?',
                    (owner, project_id, state['document']['id'])).fetchone()
                if not stored or stored['filename'] != state['document']['file_name'] or stored['size'] != state['document'].get('file_size'):
                    raise AppError('cv_file_missing', '原始檔案尚未保存，請重新上傳。', 409)
            changed = db.execute("UPDATE projects SET state=?,state_version=state_version+1,updated_at=? WHERE owner=? AND id=? AND state_version=? AND status='active'",
                                 (json.dumps(state, ensure_ascii=False), now(), owner, project_id, version)).rowcount
            if changed != 1:
                raise conflict()
            self.event(db, owner, project_id, kind, {'revision': state['revision']}, state['document']['id'])
            if kind in ('start', 'replace'):
                db.execute('DELETE FROM cv_files WHERE owner=? AND project_id=? AND document_id<>?', (owner, project_id, state['document']['id']))

    def save_cv_file(self, owner, project_id, version, document_id, filename, content):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            project = self.get(owner, project_id, active=True, db=db)
            if project['state_version'] != version:
                raise conflict()
            current = (project['state'] or {}).get('document', {}).get('id', '')
            db.execute('DELETE FROM cv_files WHERE owner=? AND project_id=? AND document_id<>?', (owner, project_id, current))
            db.execute('INSERT INTO cv_files(owner,project_id,document_id,filename,content) VALUES(?,?,?,?,?)',
                (owner, project_id, document_id, filename, content))

    def get_cv_file(self, owner, project_id, document_id):
        with self.connect() as db:
            self.get(owner, project_id, db=db)
            row = db.execute('SELECT filename,content FROM cv_files WHERE owner=? AND project_id=? AND document_id=?',
                (owner, project_id, document_id)).fetchone()
            return dict(row) if row else None

    def save_ui(self, owner, project_id, revision, ui):
        with self.connect() as db:
            changed = db.execute("UPDATE projects SET ui=?,ui_revision=ui_revision+1 WHERE owner=? AND id=? AND ui_revision=? AND status='active'",
                                 (json.dumps(ui, ensure_ascii=False), owner, project_id, revision)).rowcount
            if changed != 1:
                raise conflict()
        return revision + 1

    def history(self, owner, project_id):
        self.get(owner, project_id)
        with self.connect() as db:
            rows = db.execute('SELECT id,created_at,kind,detail,document_id FROM project_history WHERE owner=? AND project_id=? ORDER BY id DESC LIMIT 300', (owner, project_id)).fetchall()
        return [{**dict(r), 'detail': json.loads(r['detail'])} for r in rows]

    def interview(self, owner, project_id, document_id, detail):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            p = self.get(owner, project_id, active=True, db=db)
            if not p['state'] or p['state']['document']['id'] != document_id:
                raise conflict()
            self.event(db, owner, project_id, 'interview', detail, document_id)


def get_store():
    if os.getenv('CAREER_PROJECT_STORAGE') == 'postgres':
        from career_twin.shared.projects.project_store_sql import cloud_store
        return cloud_store()
    if os.getenv('K_SERVICE'):
        raise AppError('workspace_unavailable', '雲端工作區資料庫尚未設定。', 503)
    return ProjectStore(data_dir() / 'workspace.sqlite3')
