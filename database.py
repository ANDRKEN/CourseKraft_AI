"""Database connection and session management for CourseKraft AI."""

import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, scoped_session, sessionmaker

Base = declarative_base()

_engine = None
_SessionFactory = None
db_session = scoped_session(lambda: _SessionFactory())


DEFAULT_DATABASE_URL = "postgresql://neondb_owner:npg_Autpqi8mxr0f@ep-young-waterfall-a15odmxo-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"


def get_database_url():
    """Retrieve and normalize DATABASE_URL from environment or fallback."""
    url = os.getenv("DATABASE_URL", "").strip() or DEFAULT_DATABASE_URL
    # SQLAlchemy 1.4+ expects 'postgresql://' instead of legacy 'postgres://'
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    # Channel binding can cause SCRAM-SHA-256-PLUS crashes on systems lacking TLS channel binding support
    if "channel_binding=require" in url:
        url = url.replace("&channel_binding=require", "").replace("channel_binding=require&", "").replace("channel_binding=require", "")
    return url


def init_engine(db_url=None):
    """Initialize the SQLAlchemy engine."""
    global _engine, _SessionFactory
    url = db_url or get_database_url()
    
    engine_kwargs = {
        "echo": False,
        "pool_pre_ping": True,
    }
    # SQLite-specific arguments
    if url.startswith("sqlite"):
        engine_kwargs["connect_args"] = {"check_same_thread": False}
    else:
        # PostgreSQL pool settings suitable for Neon serverless / PgBouncer
        engine_kwargs["pool_recycle"] = 300
        engine_kwargs["pool_size"] = 5
        engine_kwargs["max_overflow"] = 10
        # Disable prepared statements in psycopg to ensure full PgBouncer pooler compatibility
        engine_kwargs["connect_args"] = {"prepare_threshold": None}

    _engine = create_engine(url, **engine_kwargs)
    _SessionFactory = sessionmaker(bind=_engine, autocommit=False, autoflush=False)
    db_session.remove()
    return _engine


def init_db(app=None, db_url=None):
    """Create all tables and register cleanup with Flask app, with automatic SQLite fallback."""
    import models  # noqa: F401
    try:
        engine = init_engine(db_url)
        Base.metadata.create_all(bind=engine)
    except Exception as exc:
        # If remote PostgreSQL fails (e.g. offline, bad network, invalid credentials on another PC),
        # gracefully fall back to local SQLite so the application never crashes.
        if app and hasattr(app, "logger"):
            app.logger.warning("Remote database unavailable (%s). Falling back to local SQLite.", exc)
        engine = init_engine("sqlite:///coursekraft.db")
        Base.metadata.create_all(bind=engine)

    if app is not None and not getattr(app, "_db_teardown_registered", False):
        app._db_teardown_registered = True

        @app.teardown_appcontext
        def shutdown_session(exception=None):
            try:
                db_session.remove()
            except Exception:
                pass

    return engine
