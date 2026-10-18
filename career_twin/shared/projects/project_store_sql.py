"""Cloud SQL workspace storage. Same ownership and CAS contract as SQLite."""
import atexit
import os
import secrets
import time
from contextlib import contextmanager
from functools import lru_cache

from sqlalchemy import BigInteger, Column, Index, Integer, LargeBinary, MetaData, Table, Text, case, create_engine, delete, insert, select, update, func
from sqlalchemy.dialects.postgresql import JSONB, insert as pg_insert
from sqlalchemy.exc import SQLAlchemyError

from career_twin.shared.core.errors import AppError
from career_twin.shared.projects.project_store import conflict, now

metadata = MetaData(schema='career_workspace')
projects = Table('projects', metadata,
    Column('owner', Text, primary_key=True), Column('id', Text, primary_key=True),
    Column('name', Text, nullable=False), Column('status', Text, nullable=False, server_default='active'),
    Column('created_at', Text, nullable=False), Column('updated_at', Text, nullable=False),
    Column('state', JSONB), Column('state_version', Integer, nullable=False, server_default='0'),
    Column('ui', JSONB, nullable=False, server_default='{}'), Column('ui_revision', Integer, nullable=False, server_default='0'),
    Column('imports', JSONB, nullable=False, server_default='[]'))
history = Table('project_history', metadata,
    Column('id', BigInteger, primary_key=True, autoincrement=True), Column('owner', Text, nullable=False),
    Column('project_id', Text, nullable=False), Column('created_at', Text, nullable=False),
    Column('kind', Text, nullable=False), Column('detail', JSONB, nullable=False), Column('document_id', Text))
Index('workspace_history_scope', history.c.owner, history.c.project_id, history.c.id)
attempts = Table('login_attempts', metadata,
    Column('bucket', Text, primary_key=True), Column('window', BigInteger, nullable=False),
    Column('count', Integer, nullable=False))
beta_control = Table('beta_control', metadata,
    Column('id', Integer, primary_key=True), Column('state', JSONB, nullable=False))
cv_files = Table('cv_files', metadata,
    Column('owner', Text, primary_key=True), Column('project_id', Text, primary_key=True),
    Column('document_id', Text, primary_key=True), Column('filename', Text, nullable=False),
    Column('content', LargeBinary, nullable=False))


def unavailable():
    return AppError('workspace_unavailable', '專案資料庫暫時無法連接，請稍後重試；已有資料仍保留。', 503)


class SQLProjectStore:
    def __init__(self, engine, connector=None):
        self.engine, self.connector = engine, connector

    def close(self):
        self.engine.dispose()
        if self.connector:
            self.connector.close()

    @contextmanager
    def transaction(self):
        try:
            with self.engine.begin() as db:
                yield db
        except SQLAlchemyError:
            raise unavailable() from None

    @staticmethod
    def decode(row):
        result = dict(row)
        result.pop('owner', None)
        return result

    def get(self, owner, project_id, *, active=False, db=None, lock=False):
        if db is None:
            with self.transaction() as connection:
                return self.get(owner, project_id, active=active, db=connection, lock=lock)
        query = select(projects).where(projects.c.owner == owner, projects.c.id == project_id)
        if lock:
            query = query.with_for_update()
        row = db.execute(query).mappings().one_or_none()
        if row is None:
            raise AppError('project_missing', '找不到此專案。', 404)
        if active and row['status'] != 'active':
            raise AppError('project_archived', '此專案已封存，請先還原。', 409)
        return self.decode(row)

    def list(self, owner):
        with self.transaction() as db:
            rows = [self.decode(r) for r in db.execute(select(projects).where(projects.c.owner == owner)
                .order_by(projects.c.updated_at.desc(), projects.c.id)).mappings()]
        for p in rows:
            state = p.pop('state') or {}
            p.pop('ui')
            p['summary'] = {'has_cv': bool(state), 'confirmed': sum(i['review'] == 'confirmed' for i in state.get('items', [])),
                'jobs': len(state.get('jobs', [])), 'plans': len(state.get('plans', [])), 'versions': len(state.get('tailored', []))}
        return rows

    def event(self, db, owner, project_id, kind, detail, document_id=None):
        db.execute(insert(history).values(owner=owner, project_id=project_id, created_at=now(),
            kind=kind, detail=detail, document_id=document_id))

    def create(self, owner, name, state=None, imports=None):
        identity, timestamp = secrets.token_hex(16), now()
        with self.transaction() as db:
            db.execute(insert(projects).values(owner=owner, id=identity, name=name, created_at=timestamp,
                updated_at=timestamp, state=state, imports=imports or []))
            self.event(db, owner, identity, 'created', {'imported': bool(imports)})
            return self.get(owner, identity, db=db)

    def update(self, owner, project_id, *, name=None, status=None):
        with self.transaction() as db:
            p = self.get(owner, project_id, db=db, lock=True)
            db.execute(update(projects).where(projects.c.owner == owner, projects.c.id == project_id)
                .values(name=name or p['name'], status=status or p['status'], updated_at=now(), state_version=p['state_version']+1))
            self.event(db, owner, project_id, 'renamed' if name else status, {'name': name} if name else {})
            return self.get(owner, project_id, db=db)

    def save_state(self, owner, project_id, version, state, kind):
        with self.transaction() as db:
            self.get(owner, project_id, db=db, lock=True)
            if state['document'].get('file_name'):
                stored = db.execute(select(cv_files.c.filename, func.octet_length(cv_files.c.content).label('size')).where(
                    cv_files.c.owner == owner, cv_files.c.project_id == project_id,
                    cv_files.c.document_id == state['document']['id'])).mappings().one_or_none()
                if not stored or stored['filename'] != state['document']['file_name'] or stored['size'] != state['document'].get('file_size'):
                    raise AppError('cv_file_missing', '原始檔案尚未保存，請重新上傳。', 409)
            changed = db.execute(update(projects).where(projects.c.owner == owner, projects.c.id == project_id,
                projects.c.state_version == version, projects.c.status == 'active')
                .values(state=state, state_version=projects.c.state_version+1, updated_at=now())).rowcount
            if changed != 1:
                raise conflict()
            self.event(db, owner, project_id, kind, {'revision': state['revision']}, state['document']['id'])
            if kind in ('start', 'replace'):
                db.execute(delete(cv_files).where(cv_files.c.owner == owner, cv_files.c.project_id == project_id,
                    cv_files.c.document_id != state['document']['id']))

    def save_cv_file(self, owner, project_id, version, document_id, filename, content):
        with self.transaction() as db:
            project = self.get(owner, project_id, active=True, db=db, lock=True)
            if project['state_version'] != version:
                raise conflict()
            current = (project['state'] or {}).get('document', {}).get('id', '')
            db.execute(delete(cv_files).where(cv_files.c.owner == owner, cv_files.c.project_id == project_id,
                cv_files.c.document_id != current))
            db.execute(insert(cv_files).values(owner=owner, project_id=project_id, document_id=document_id,
                filename=filename, content=content))

    def get_cv_file(self, owner, project_id, document_id):
        with self.transaction() as db:
            self.get(owner, project_id, db=db)
            row = db.execute(select(cv_files.c.filename, cv_files.c.content).where(cv_files.c.owner == owner,
                cv_files.c.project_id == project_id, cv_files.c.document_id == document_id)).mappings().one_or_none()
            return dict(row) if row else None

    def save_ui(self, owner, project_id, revision, ui):
        with self.transaction() as db:
            changed = db.execute(update(projects).where(projects.c.owner == owner, projects.c.id == project_id,
                projects.c.ui_revision == revision, projects.c.status == 'active')
                .values(ui=ui, ui_revision=projects.c.ui_revision+1)).rowcount
            if changed != 1:
                raise conflict()
        return revision+1

    def history(self, owner, project_id):
        with self.transaction() as db:
            self.get(owner, project_id, db=db)
            return [dict(r) for r in db.execute(select(history.c.id, history.c.created_at, history.c.kind,
                history.c.detail, history.c.document_id).where(history.c.owner == owner, history.c.project_id == project_id)
                .order_by(history.c.id.desc()).limit(300)).mappings()]

    def interview(self, owner, project_id, document_id, detail):
        with self.transaction() as db:
            p = self.get(owner, project_id, active=True, db=db, lock=True)
            if not p['state'] or p['state']['document']['id'] != document_id:
                raise conflict()
            self.event(db, owner, project_id, 'interview', detail, document_id)

    def allow_login(self, buckets, timestamp=None):
        """Reserve attempts atomically across instances; retain at most 24h of IP hashes."""
        timestamp = int(time.time() if timestamp is None else timestamp)
        accepted = True
        with self.transaction() as db:
            db.execute(delete(attempts).where(attempts.c.window < timestamp-86400))
            for bucket, limit, seconds in sorted(buckets):
                window = timestamp//seconds*seconds
                query = pg_insert(attempts).values(bucket=bucket, window=window, count=1)
                query = query.on_conflict_do_update(index_elements=[attempts.c.bucket], set_={
                    'window': window,
                    'count': case((attempts.c.window == window, attempts.c.count+1), else_=1),
                }).returning(attempts.c.count)
                accepted = db.execute(query).scalar_one() <= limit and accepted
        return accepted

    def beta_change(self, **kwargs):
        from career_twin.shared.core.beta_access import transition
        with self.transaction() as db:
            state = db.execute(select(beta_control.c.state).where(beta_control.c.id == 1).with_for_update()).scalar_one_or_none()
            if state is None:
                raise unavailable()
            decision = transition(state, **kwargs)
            db.execute(update(beta_control).where(beta_control.c.id == 1).values(state=state))
            return decision


@lru_cache(maxsize=1)
def cloud_store():
    from google.cloud.sql.connector import Connector
    instance = os.getenv('CAREER_PROJECT_SQL_INSTANCE', '')
    name = os.getenv('CAREER_PROJECT_SQL_DATABASE', '')
    user = os.getenv('CAREER_PROJECT_SQL_USER', '')
    if not all((instance, name, user)):
        raise unavailable()
    connector = Connector(refresh_strategy='lazy', timeout=10)
    def connect():
        try:
            return connector.connect(instance, 'psycopg', user=user, db=name, enable_iam_auth=True,
                connect_timeout=5, options='-c statement_timeout=15000 -c lock_timeout=5000')
        except Exception:
            raise unavailable() from None
    engine = create_engine('postgresql+psycopg://', creator=connect, pool_size=3, max_overflow=0,
        pool_timeout=5, pool_recycle=1800, pool_pre_ping=True, echo=False, hide_parameters=True)
    store = SQLProjectStore(engine, connector)
    atexit.register(store.close)
    return store
