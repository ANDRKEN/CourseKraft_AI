"""Security utilities: password validation, CSRF tokens, and timed recovery tokens."""

import os
import re
import secrets
from flask import session
from itsdangerous import URLSafeTimedSerializer, SignatureExpired, BadSignature


def get_secret_key():
    """Retrieve application secret key from environment or fallback."""
    return os.getenv("SECRET_KEY", "coursekraft-atelier-secret-key-prod-2026")


def get_timed_serializer():
    """Return itsdangerous serializer configured with secret key."""
    return URLSafeTimedSerializer(get_secret_key())


def generate_reset_token(email):
    """Generate a secure, time-limited password recovery token (valid for 1 hour)."""
    s = get_timed_serializer()
    return s.dumps(email.lower().strip(), salt="password-reset-salt")


def verify_reset_token(token, max_age_seconds=3600):
    """Verify password recovery token. Returns email if valid, None otherwise."""
    s = get_timed_serializer()
    try:
        email = s.loads(token, salt="password-reset-salt", max_age=max_age_seconds)
        return email
    except (SignatureExpired, BadSignature):
        return None


def generate_csrf_token():
    """Generate or retrieve a per-session CSRF token."""
    if "_csrf_token" not in session:
        session["_csrf_token"] = secrets.token_hex(32)
    return session["_csrf_token"]


def validate_csrf_token(token):
    """Validate submitted CSRF token against session."""
    session_token = session.get("_csrf_token")
    if not session_token or not token:
        return False
    return secrets.compare_digest(session_token, token)


def validate_password_strength(password):
    """Validate password meets minimum security standards."""
    if not password or len(password) < 8:
        return "Password must be at least 8 characters long."
    if len(password) > 128:
        return "Password must not exceed 128 characters."
    return None


def validate_email_format(email):
    """Validate email address format."""
    if not email:
        return "Email address is required."
    pattern = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
    if not re.match(pattern, email.strip()):
        return "Please enter a valid email address."
    return None
