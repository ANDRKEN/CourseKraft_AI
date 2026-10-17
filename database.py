"""Database connection and session management for CourseKraft AI."""

import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, scoped_session, sessionmaker

Base = declarative_base()

_engine = None
_SessionFactory = None
db_session = scoped_session(lambda: _SessionFactory())


def get_database_url():
    """Retrieve and normalize DATABASE_URL from environment."""
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        return "sqlite:///coursekraft.db"
    # SQLAlchemy 1.4+ expects 'postgresql://' instead of legacy 'postgres://'
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
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
        # PostgreSQL pool settings suitable for Neon serverless
        engine_kwargs["pool_recycle"] = 300
        engine_kwargs["pool_size"] = 5
        engine_kwargs["max_overflow"] = 10

    _engine = create_engine(url, **engine_kwargs)
    _SessionFactory = sessionmaker(bind=_engine, autocommit=False, autoflush=False)
    db_session.remove()
    return _engine


def init_db(app=None, db_url=None):
    """Create all tables and register cleanup with Flask app."""
    engine = init_engine(db_url)
    # Import models to ensure they are registered with Base.metadata
    import models  # noqa: F401
    Base.metadata.create_all(bind=engine)

    if app is not None and not getattr(app, "_db_teardown_registered", False):
        app._db_teardown_registered = True

        @app.teardown_appcontext
        def shutdown_session(exception=None):
            db_session.remove()

    return engine
