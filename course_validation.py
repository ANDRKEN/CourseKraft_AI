"""Small validators for course-generation requests and course content."""

import json


MAX_COURSE_BYTES = 2 * 1024 * 1024
MAX_COLLECTION_ITEMS = {
    "objectives": 30,
    "slides": 60,
    "codeExamples": 30,
    "exercises": 60,
    "quiz": 100,
    "cheatSheet": 100,
}

_TOP_LEVEL_TEXT = {
    "title": 180,
    "topic": 180,
    "level": 50,
    "language": 40,
}
_MISSING = object()


def validate_generation_request(data):
    """Return normalized generation inputs or a client-readable error."""
    if not isinstance(data, dict):
        return None, "Request body must be a JSON object."

    topic = data.get("topic", "")
    if not isinstance(topic, str):
        return None, "Topic must be text."
    topic = topic.strip()
    if not topic:
        return None, "Please enter a topic."
    topic = topic[:_TOP_LEVEL_TEXT["topic"]]

    level = data.get("level", "Beginner")
    if not isinstance(level, str):
        return None, "Learner level must be text."
    level = level.strip()
    if not level or len(level) > _TOP_LEVEL_TEXT["level"]:
        return None, "Learner level must be between 1 and 50 characters."

    language = data.get("language", "Java")
    if not isinstance(language, str):
        return None, "Programming language must be text."
    language = language.strip()
    if not language or len(language) > _TOP_LEVEL_TEXT["language"]:
        return None, "Programming language must be between 1 and 40 characters."

    raw_duration = data.get("durationMinutes", 45)
    if isinstance(raw_duration, bool) or not isinstance(raw_duration, (int, str)):
        return None, "Duration must be a whole number of minutes."
    try:
        duration = int(raw_duration)
    except (TypeError, ValueError):
        return None, "Duration must be a whole number of minutes."

    return {
        "topic": topic,
        "level": level,
        "durationMinutes": max(10, min(240, duration)),
        "language": language,
    }, None


def _check_text(value, field, maximum, required=False):
    if value is _MISSING and not required:
        return None
    if not isinstance(value, str):
        return f"'{field}' must be text."
    if required and not value.strip():
        return f"'{field}' must not be empty."
    if len(value) > maximum:
        return f"'{field}' must be {maximum} characters or fewer."
    return None


def _check_text_list(value, field, *, max_items, max_text, required=False, min_items=0):
    if value is _MISSING and not required:
        return None
    if not isinstance(value, list):
        return f"'{field}' must be a list."
    if len(value) > max_items:
        return f"'{field}' must contain {max_items} items or fewer."
    if len(value) < min_items:
        return f"'{field}' must contain at least {min_items} items."
    for index, item in enumerate(value):
        error = _check_text(item, f"{field}[{index}]", max_text, required=True)
        if error:
            return error
    return None


def _check_object_list(course, field, *, max_items, required=False):
    value = course.get(field, _MISSING)
    if value is _MISSING and not required:
        return None
    if not isinstance(value, list):
        return f"Course field '{field}' must be a list."
    if len(value) > max_items:
        return f"Course field '{field}' must contain {max_items} items or fewer."
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            return f"Items in course field '{field}' must be JSON objects."
        error = _validate_item(field, item, index, required=required)
        if error:
            return error
    return None


def _validate_item(field, item, index, *, required):
    prefix = f"{field}[{index}]"
    if field == "slides":
        for name, maximum, is_required in (
            ("title", 240, required),
            ("speakerNotes", 12000, False),
        ):
            error = _check_text(item.get(name, _MISSING), f"{prefix}.{name}", maximum, is_required)
            if error:
                return error
        error = _check_text_list(
            item.get("bullets", _MISSING), f"{prefix}.bullets", max_items=40,
            max_text=4000, required=required,
        )
        if error:
            return error
        error = _check_text(item.get("visualType", _MISSING), f"{prefix}.visualType", 40)
        if error:
            return error
        error = _check_text(item.get("visualDescription", _MISSING), f"{prefix}.visualDescription", 2000)
        if error:
            return error
        return _check_text_list(
            item.get("visualLabels", _MISSING), f"{prefix}.visualLabels",
            max_items=8, max_text=200,
        )

    if field == "codeExamples":
        limits = {"id": 120, "title": 240, "language": 40, "code": 12000,
                  "testDescription": 2000, "expectedOutput": 4000}
        for name, maximum in limits.items():
            error = _check_text(item.get(name, _MISSING), f"{prefix}.{name}", maximum,
                                required=required and name in ("title", "language", "code"))
            if error:
                return error
        return None

    if field == "exercises":
        for name, maximum, is_required in (
            ("title", 240, required),
            ("description", 4000, required),
            ("difficulty", 40, False),
            ("testHint", 2000, False),
        ):
            error = _check_text(item.get(name, _MISSING), f"{prefix}.{name}", maximum, is_required)
            if error:
                return error
        return None

    if field == "quiz":
        for name, maximum, is_required in (
            ("question", 2000, required),
            ("explanation", 3000, False),
        ):
            error = _check_text(item.get(name, _MISSING), f"{prefix}.{name}", maximum, is_required)
            if error:
                return error
        error = _check_text_list(
            item.get("options", _MISSING), f"{prefix}.options", max_items=8,
            max_text=1000, required=required, min_items=2 if required else 0,
        )
        if error:
            return error
        if "correctIndex" in item:
            index_value = item["correctIndex"]
            options = item.get("options", [])
            if isinstance(index_value, bool) or not isinstance(index_value, int):
                return f"'{prefix}.correctIndex' must be an integer."
            if not isinstance(options, list) or not 0 <= index_value < len(options):
                return f"'{prefix}.correctIndex' must refer to an available option."
        elif required:
            return f"'{prefix}.correctIndex' is required."
        return None

    if field == "cheatSheet":
        for name, maximum in (("term", 240), ("definition", 3000)):
            error = _check_text(item.get(name, _MISSING), f"{prefix}.{name}", maximum, required)
            if error:
                return error
        return None

    return None


def validate_course(course, *, require_generated_fields=False, require_title=False):
    """Validate known course fields without rejecting unknown extension metadata."""
    if not isinstance(course, dict):
        return "Course payload must be a JSON object."
    try:
        size = len(json.dumps(course, ensure_ascii=False).encode("utf-8"))
    except (TypeError, ValueError):
        return "Course payload must contain JSON-compatible values."
    if size > MAX_COURSE_BYTES:
        return "Course payload is too large (maximum 2 MB)."

    required_fields = {"title"} if require_title else set()
    if require_generated_fields:
        required_fields.update({"title", "topic", "level", "language"})
    for field, maximum in _TOP_LEVEL_TEXT.items():
        if field in course or field in required_fields:
            error = _check_text(course.get(field, _MISSING), field, maximum,
                                required=field in required_fields)
            if error:
                return error

    if require_generated_fields and "durationMinutes" not in course:
        return "Course field 'durationMinutes' is required."
    if "durationMinutes" in course:
        duration = course["durationMinutes"]
        if isinstance(duration, bool) or not isinstance(duration, int) or not 1 <= duration <= 240:
            return "Course field 'durationMinutes' must be a whole number from 1 to 240."

    if require_generated_fields and "objectives" not in course:
        return "Course field 'objectives' is required."
    if "objectives" in course:
        error = _check_text_list(
            course["objectives"], "objectives", max_items=30, max_text=500,
            required=require_generated_fields, min_items=1 if require_generated_fields else 0,
        )
        if error:
            return error

    for field, max_items in MAX_COLLECTION_ITEMS.items():
        if field == "objectives":
            continue
        required = require_generated_fields and field in {
            "slides", "codeExamples", "exercises", "quiz", "cheatSheet"
        }
        error = _check_object_list(course, field, max_items=max_items, required=required)
        if error:
            return error
        if require_generated_fields and field in {"exercises", "quiz", "cheatSheet"} and not course[field]:
            return f"Course field '{field}' must contain at least one item."
    if require_generated_fields and not course["slides"]:
        return "Course field 'slides' must contain at least one slide."
    return None
