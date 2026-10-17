"""SQLAlchemy models for CourseKraft AI Teacher Accounts and Saved Courses."""

import uuid
import json
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import UserMixin
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from database import Base


class User(Base, UserMixin):
    """Teacher account entity."""

    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    full_name = Column(String(120), nullable=False)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    courses = relationship("Course", back_populates="teacher", cascade="all, delete-orphan", order_by="desc(Course.updated_at)")

    def set_password(self, password):
        """Hash and set the user password."""
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        """Verify the password against the stored hash."""
        return check_password_hash(self.password_hash, password)

    @property
    def initials(self):
        """Compute teacher initials for display avatar."""
        parts = (self.full_name or "").strip().split()
        if not parts:
            return "T"
        if len(parts) == 1:
            return parts[0][:2].upper()
        return (parts[0][0] + parts[-1][0]).upper()

    def to_dict(self):
        """Serialize teacher profile for client responses."""
        return {
            "id": self.id,
            "fullName": self.full_name,
            "email": self.email,
            "initials": self.initials,
            "courseCount": len(self.courses),
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f"<User id={self.id} email='{self.email}'>"


class Course(Base):
    """Saved course entity owned by an authenticated teacher."""

    __tablename__ = "courses"

    id = Column(String(64), primary_key=True, default=lambda: f"ck_{uuid.uuid4().hex[:16]}")
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    topic = Column(String(255), nullable=False)
    level = Column(String(64), default="Beginner", nullable=False)
    duration_minutes = Column(Integer, default=45, nullable=False)
    language = Column(String(64), default="Java", nullable=False)
    content_json = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    teacher = relationship("User", back_populates="courses")

    def get_content(self):
        """Deserialize stored course JSON."""
        try:
            return json.loads(self.content_json)
        except Exception:
            return {}

    def set_content(self, content_dict):
        """Serialize course dictionary into JSON."""
        self.content_json = json.dumps(content_dict)

    def to_dict(self, full=True):
        """Serialize course into the CourseKraft studio schema."""
        content = self.get_content()
        data = {
            "id": self.id,
            "title": self.title,
            "topic": self.topic,
            "level": self.level,
            "durationMinutes": self.duration_minutes,
            "language": self.language,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
            "slideCount": len(content.get("slides", [])) if content else 0,
            "_source": "Saved Course",
        }
        if full:
            # Merge complete structural content
            data.update({
                "objectives": content.get("objectives", []),
                "slides": content.get("slides", []),
                "codeExamples": content.get("codeExamples", []),
                "exercises": content.get("exercises", []),
                "quiz": content.get("quiz", []),
                "cheatSheet": content.get("cheatSheet", []),
            })
        return data

    def __repr__(self):
        return f"<Course id='{self.id}' title='{self.title}'>"
