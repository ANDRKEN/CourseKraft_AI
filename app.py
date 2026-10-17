import os, json
from flask import Flask, render_template, request, jsonify, send_file, redirect, url_for, flash, session
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.middleware.proxy_fix import ProxyFix
from dotenv import load_dotenv
load_dotenv()
from course_validation import MAX_COURSE_BYTES, validate_course, validate_generation_request
from course_exports import create_pdf, create_pptx
import gemini_provider
import judge0_provider
import database
from models import User, Course
from security import (
    generate_csrf_token,
    validate_csrf_token,
    validate_password_strength,
    validate_email_format,
    generate_reset_token,
    verify_reset_token,
)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_COURSE_BYTES
app.secret_key = os.getenv("SECRET_KEY", "coursekraft-atelier-secret-key-prod-2026")
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
)
# Enable ProxyFix for Render / reverse proxy HTTPS and IP resolution
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

database.init_db(app)

login_manager = LoginManager()
login_manager.login_view = "login"
login_manager.login_message = "Please sign in to access your course vault."
login_manager.login_message_category = "info"
login_manager.init_app(app)

@login_manager.user_loader
def load_user(user_id):
    try:
        return database.db_session.get(User, int(user_id))
    except Exception:
        return None

@app.context_processor
def inject_globals():
    return dict(csrf_token=generate_csrf_token)
DEFAULT_GEMINI_API_KEY = "AQ.Ab8RN6IioflNkbVPGA1k6ijey4-IvPJAMlDV3drVbnPOorbZ_w"
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip() or DEFAULT_GEMINI_API_KEY
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"
_DEFAULT_GEMINI_FALLBACK_MODELS = ("gemini-3.5-flash-lite", "gemini-3.8-flash")
_fallback_models = os.getenv("GEMINI_FALLBACK_MODELS", "").strip()
GEMINI_FALLBACK_MODELS = (
    tuple(model.strip() for model in _fallback_models.split(",") if model.strip())
    if _fallback_models else _DEFAULT_GEMINI_FALLBACK_MODELS
)
DEFAULT_ONLINECOMPILER_API_KEY = "438b6105aaa851973daed771de945a48"
ONLINECOMPILER_API_KEY = os.getenv("ONLINECOMPILER_API_KEY", "").strip() or DEFAULT_ONLINECOMPILER_API_KEY
JUDGE0_URL = os.getenv("JUDGE0_URL", "").strip().rstrip("/")
JUDGE0_API_KEY = os.getenv("JUDGE0_API_KEY", "").strip()
JUDGE0_API_KEY_HEADER = os.getenv("JUDGE0_API_KEY_HEADER", "").strip()
JUDGE0_LANGUAGE_IDS = os.getenv("JUDGE0_LANGUAGE_IDS", "").strip()
MAX_CODE_LENGTH = 12000
MAX_EXPECTED_OUTPUT_LENGTH = 4000

SAMPLE_COURSE = {
    "title": "Object-Oriented Programming in Java",
    "topic": "Object-Oriented Programming in Java",
    "level": "Beginner",
    "durationMinutes": 45,
    "language": "Java",
    "objectives": [
        "Explain classes and objects",
        "Describe constructors and encapsulation",
        "Apply object-oriented concepts in a small Java program",
        "Implement inheritance, method overriding, and polymorphism",
        "Differentiate interface abstractions and composition strategies"
    ],
    "slides": [
        {"title":"What is OOP?","bullets":["A programming approach built around objects","Objects combine state (data) and behaviour (methods)","Java supports classes, inheritance, polymorphism and encapsulation"],"speakerNotes":"Start with a real-world example such as a Student object.","visualType":"comparison","visualDescription":"Contrast an object’s state with the operations it can perform.","visualLabels":["State / fields","Behaviour / methods"]},
        {"title":"Classes and Objects","bullets":["A class is a blueprint","An object is an instance of a class","Fields represent state; methods represent behaviour"],"speakerNotes":"Compare a class to a blueprint and objects to actual houses built from it.","visualType":"flowchart","visualDescription":"Show a class blueprint producing concrete object instances.","visualLabels":["Class blueprint","Instantiate","Student object"]},
        {"title":"Encapsulation","bullets":["Keep data and behaviour together","Use access modifiers to control access","Expose safe operations through methods"],"speakerNotes":"Explain why fields are often private and accessed through methods.","visualType":"flowchart","visualDescription":"Illustrate private fields being accessed through a safe public method.","visualLabels":["Private state","Public method","Safe update"]},
        {"title":"Inheritance & Hierarchy","bullets":["Inheritance allows code reuse via the extends keyword","Child classes inherit non-private fields and methods","Java supports single-class inheritance and multiple interface implementation"],"speakerNotes":"Contrast a generic Vehicle base class with specialized Car and Truck subclasses.","visualType":"flowchart","visualDescription":"Show base Vehicle class inheriting down to specialized types.","visualLabels":["Vehicle Superclass","extends","Car Subclass"]},
        {"title":"Key Takeaways","bullets":["Classes define structure; objects are runtime instances","Encapsulation protects internal state from unintended tampering","Inheritance and polymorphism enable clean, extensible designs","Practise by modelling a real-world system with domain classes"],"speakerNotes":"Ask students to describe one class hierarchy they would design for a library management system."}
    ],
    "codeExamples": [
        {"id":"java-001","title":"Class and object example","language":"java","code":"public class Main {\n  static class Student {\n    String name;\n    Student(String name) { this.name = name; }\n  }\n  public static void main(String[] args) {\n    Student s = new Student(\"Asha\");\n    System.out.println(s.name);\n  }\n}","testDescription":"Expected output: Asha","expectedOutput":"Asha"}
    ],
    "exercises": [
        {"title":"Create a Book class","description":"Create a Book class with title and author fields, then create one object and print its title.","difficulty":"Easy","testHint":"The output should include the book title."},
        {"title":"Add a constructor","description":"Add a constructor that initializes the title and author fields.","difficulty":"Medium","testHint":"Create the object using the constructor and print both fields."},
        {"title":"Implement an interface","description":"Declare a Printable interface with a printDetails() method and implement it on an Employee class.","difficulty":"Hard","testHint":"Ensure Employee provides a concrete printDetails() implementation."}
    ],
    "quiz": [
        {"question":"What is a class in Java?","options":["A blueprint for objects","A running process","A database table","A primitive loop"],"correctIndex":0,"explanation":"A class defines the fields and methods that its objects can have."},
        {"question":"Which statement best describes an object?","options":["A package of source files","An instance of a class","A compiler error","A primitive data type"],"correctIndex":1,"explanation":"An object is an instantiated entity in memory created from a class blueprint."},
        {"question":"What is the main purpose of encapsulation?","options":["Make every field public","Control access to internal state","Eliminate methods","Replace constructors"],"correctIndex":1,"explanation":"Encapsulation bundles state and behaviour while controlling external access via access modifiers and methods."},
        {"question":"How is runtime polymorphism achieved in Java?","options":["By overloading methods with different parameter counts","By overriding superclass methods in a subclass and calling them via superclass reference","By declaring variables with the final keyword","By writing multiple constructors"],"correctIndex":1,"explanation":"Runtime polymorphism occurs when a subclass overrides a superclass method, and the JVM resolves the call at runtime based on the actual object type."},
        {"question":"What is the purpose of invoking super() in a subclass constructor?","options":["It terminates the constructor execution","It initializes the superclass state before subclass fields are configured","It converts the subclass into an abstract class","It allocates static memory for the entire JVM"],"correctIndex":1,"explanation":"super() calls the parent class constructor to guarantee that inherited state is properly initialized before subclass code executes."},
        {"question":"What distinguishes a static method from an instance method in Java?","options":["Static methods belong to the class and can be invoked without creating an instance","Static methods cannot accept parameters","Static methods can directly access private instance fields using 'this'","Static methods run on a separate background thread"],"correctIndex":0,"explanation":"Static methods belong to the class itself rather than to individual instances, meaning they cannot access non-static instance fields directly."}
    ],
    "cheatSheet": [
        {"term":"Class","definition":"A blueprint or template defining the fields (state) and methods (behaviour) for objects.","category":"Core Principles","example":"class Car { String model; void drive() {} }","related":["Object","Constructor","Encapsulation"]},
        {"term":"Object","definition":"A concrete instance of a class allocated in memory with its own identity and state.","category":"Core Principles","example":"Car myCar = new Car();","related":["Class","Constructor"]},
        {"term":"Encapsulation","definition":"Bundling data and methods while restricting direct access to internal state using private fields and public accessors.","category":"Core Principles","example":"private int speed;\npublic int getSpeed() { return speed; }","related":["Class","Object","Abstraction"]},
        {"term":"Abstraction","definition":"Hiding complex implementation details and exposing only essential features to the user.","category":"Core Principles","example":"abstract class Shape { abstract double area(); }","related":["Interface","Abstract Class","Encapsulation"]},
        {"term":"Inheritance","definition":"Mechanism where a child class acquires fields and methods of a parent class via the 'extends' keyword.","category":"Core Principles","example":"class ElectricCar extends Car { int batteryLevel; }","related":["Polymorphism","super Keyword","Method Overriding"]},
        {"term":"Polymorphism","definition":"The ability of different classes to respond to the same method call in their own specific way via dynamic dispatch.","category":"Core Principles","example":"Shape s = new Circle(); s.draw();","related":["Inheritance","Method Overriding","Interface"]},
        {"term":"Constructor","definition":"A special method with the same name as the class and no return type, invoked automatically to initialize new instances.","category":"Lifecycle & Memory","example":"Car(String m) { this.model = m; }","related":["Class","Object","this Keyword","super Keyword"]},
        {"term":"this Keyword","definition":"A reference to the current object instance, commonly used to disambiguate field names from parameter names.","category":"Lifecycle & Memory","example":"this.model = model;","related":["Constructor","Object","super Keyword"]},
        {"term":"super Keyword","definition":"A reference used inside a subclass to call superclass constructors or access overridden superclass methods.","category":"Lifecycle & Memory","example":"super(model); super.drive();","related":["Inheritance","Constructor","this Keyword"]},
        {"term":"Garbage Collection","definition":"Automatic JVM memory management that detects and deallocates memory occupied by unreachable objects.","category":"Lifecycle & Memory","example":"myCar = null; // object becomes eligible for GC","related":["Object","Lifecycle & Memory"]},
        {"term":"Interface","definition":"A contract that specifies method signatures without implementation, allowing multiple inheritance of type.","category":"Design & Modularity","example":"interface Autonomous { void autoPilot(); }","related":["Abstraction","Abstract Class","Polymorphism"]},
        {"term":"Abstract Class","definition":"A class marked abstract that cannot be directly instantiated and can contain both abstract and concrete methods.","category":"Design & Modularity","example":"abstract class Vehicle { void start() { ... } }","related":["Interface","Inheritance","Abstraction"]},
        {"term":"Method Overriding","definition":"Providing a specialized implementation in a subclass for a method already defined in its superclass.","category":"Design & Modularity","example":"@Override void drive() { ... }","related":["Polymorphism","Inheritance"]},
        {"term":"Composition","definition":"Designing classes by combining objects of other classes ('has-a' relationship) rather than inheriting ('is-a').","category":"Design & Modularity","example":"class Car { private final Engine engine = new Engine(); }","related":["Inheritance","Object","Class"]}
    ]
}

async def call_gemini(prompt):
    if not GEMINI_API_KEY:
        return None, "AI generation is unavailable because GEMINI_API_KEY is not configured."
    try:
        response_text = await gemini_provider.generate_content_text(
            GEMINI_API_KEY, GEMINI_MODEL, prompt,
            fallback_models=GEMINI_FALLBACK_MODELS,
        )
    except gemini_provider.GeminiProviderError as error:
        return None, error.user_message
    try:
        text = response_text
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        parsed = json.loads(text)
    except (IndexError, KeyError, TypeError, ValueError):
        return None, "AI provider returned invalid course content: response was not valid course JSON."
    if not isinstance(parsed, dict):
        return None, "AI provider returned invalid course content: response must be a JSON object."
    validation_error = validate_course(parsed, require_generated_fields=True)
    if validation_error:
        return None, "AI provider returned invalid course content: " + validation_error
    return parsed, "Generated with Gemini API."

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/status")
def status():
    runner_configured = bool(JUDGE0_URL) or (bool(ONLINECOMPILER_API_KEY) and not app.config.get("TESTING"))
    return jsonify({"geminiConfigured": bool(GEMINI_API_KEY), "judge0Configured": runner_configured,
                    "geminiConnectivity": "not_checked", "model": GEMINI_MODEL,
                    "message": "Gemini is contacted only after you request generation; credentials alone do not confirm connectivity."})

@app.errorhandler(RequestEntityTooLarge)
def request_too_large(_error):
    return jsonify({"error":"Request body is too large (maximum 2 MB)."}), 413

@app.route("/api/sample")
def sample():
    course = json.loads(json.dumps(SAMPLE_COURSE))
    course["_source"] = "Sample content"
    return jsonify({"course":course, "message":"Loaded the fixed Java and OOP sample course.",
                    "source":course["_source"], "generationStatus":"sample"})

@app.route("/api/generate", methods=["POST"])
async def generate():
    try:
        data = request.get_json(silent=True)
        inputs, validation_error = validate_generation_request(data)
        if validation_error:
            return jsonify({"error":validation_error}), 400
        topic = inputs["topic"]
        level = inputs["level"]
        duration = inputs["durationMinutes"]
        language = inputs["language"]
        prompt = build_generation_prompt(topic, level, duration, language)
        course, message = await call_gemini(prompt)
        if not course:
            invalid_content = message.startswith("AI provider returned invalid course content:")
            return jsonify({"course":None, "message":message, "source":"unavailable",
                            "generationStatus":"invalid" if invalid_content else "unavailable",
                            **({"error":message} if invalid_content else {})}), 502 if invalid_content else 503
        validation_error = validate_course(course, require_generated_fields=True)
        if validation_error:
            message = "AI provider returned invalid course content: " + validation_error
            return jsonify({"course":None, "message":message, "error":message, "source":"unavailable",
                            "generationStatus":"invalid"}), 502
        # The submitted settings remain authoritative if a model drifts from its brief.
        course["topic"] = topic
        course["level"] = level
        course["durationMinutes"] = duration
        course["language"] = language
        course["_source"] = "Gemini AI"
        if current_user.is_authenticated:
            try:
                saved_course = Course(
                    user_id=current_user.id,
                    title=course.get("title", topic),
                    topic=topic,
                    level=level,
                    duration_minutes=duration,
                    language=language,
                )
                saved_course.set_content(course)
                database.db_session.add(saved_course)
                database.db_session.commit()
                course["id"] = saved_course.id
                course["saved"] = True
                course["_source"] = f"Gemini AI (Saved to {current_user.full_name}'s vault)"
            except Exception as db_err:
                app.logger.warning("Vault auto-save failed during course generation: %s", db_err)
                try:
                    database.db_session.rollback()
                except Exception:
                    database.db_session.remove()
        return jsonify({"course":course, "message":message, "source":course["_source"],
                        "generationStatus":"generated"})
    except Exception as exc:
        app.logger.exception("Unexpected error in /api/generate: %s", exc)
        return jsonify({
            "course": None,
            "message": f"Generation service error: {str(exc)}",
            "source": "unavailable",
            "generationStatus": "unavailable",
            "error": "The course could not be generated. Please retry or adjust parameters."
        }), 503


def build_generation_prompt(topic, level, duration, language):
    """Build the generation brief from the user's submitted course settings."""
    return f"""
You are CourseKraft AI, an instructional designer creating a topic-specific teaching pack.
Do not reuse fixed sample content or invent citations, statistics, or verification results.
Topic: {topic}
Learner level: {level}
Session duration: {duration} minutes
Preferred programming language: {language}
Return exactly this JSON shape:
{{
"title": string, "topic": string, "level": string, "durationMinutes": number, "language": string,
"objectives": [string],
"slides": [{{"title": string, "bullets": [string], "speakerNotes": string,
  "visualType": "image"|"flowchart"|"architecture"|"timeline"|"comparison"|"chart"|"none",
  "visualDescription": string, "visualLabels": [string]}}],
"codeExamples": [{{"id": string, "title": string, "language": "java"|"python"|"javascript"|"cpp", "code": string, "testDescription": string, "expectedOutput": string}}],
"exercises": [{{"title": string, "description": string, "difficulty": "Easy"|"Medium"|"Hard", "testHint": string}}],
"quiz": [{{"question": string, "options": [four strings], "correctIndex": integer 0-3, "explanation": string}}],
"cheatSheet": [{{"term": string, "definition": string, "category": string, "example": string, "related": [string]}}]
}}
Requirements:
- Return JSON only, with no markdown fences. Match the supplied topic, learner level, duration, and language.
- Include 3-5 measurable learning objectives and 7-8 useful slides in a coherent teaching sequence.
- Give each slide 2-4 specific bullets, 40-70 words of trainer notes, and the visual metadata fields above. Use "none" and [] when a visual is not useful; describe a suggested image without claiming one was created.
- Include one or two complete code examples when programming is relevant. Include realistic expected output and a test description, but do not claim the example was executed. Use an empty codeExamples list when programming is not relevant.
- Include two to three practical exercises with acceptance hints, 5-7 comprehensive quiz questions with four plausible options and pedagogic explanations, and 10-14 rich cheat-sheet terms with concise definitions, category tags, quick syntax examples, and related concept links.
- Keep every field concise and specific. Avoid repetition and filler. Do not put provider status or verification claims in the course.
"""

@app.route("/api/verify", methods=["POST"])
async def verify():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error":"Request body must be a JSON object."}), 400
    language = data.get("language", "java")
    code = data.get("code", "")
    expected = data.get("expectedOutput", "")
    if not isinstance(language, str) or not language.strip() or len(language) > 40:
        return jsonify({"error":"Language must be a non-empty text value of 40 characters or fewer."}), 400
    if not isinstance(code, str):
        return jsonify({"error":"Code must be text."}), 400
    if len(code) > MAX_CODE_LENGTH:
        return jsonify({"error":f"Code must be {MAX_CODE_LENGTH} characters or fewer."}), 400
    if not isinstance(expected, str):
        return jsonify({"error":"Expected output must be text."}), 400
    if len(expected) > MAX_EXPECTED_OUTPUT_LENGTH:
        return jsonify({"error":f"Expected output must be {MAX_EXPECTED_OUTPUT_LENGTH} characters or fewer."}), 400
    language = language.strip().lower()
    expected = expected.rstrip("\r\n")
    if not code.strip():
        return jsonify({"status":"NOT VERIFIED","message":"No code was supplied.","runnerDescription":"No code was submitted."})
    if JUDGE0_URL:
        result = await judge0_provider.verify_code(
            JUDGE0_URL,
            language,
            code,
            expected,
            api_key=JUDGE0_API_KEY,
            api_key_header=JUDGE0_API_KEY_HEADER,
            language_ids=JUDGE0_LANGUAGE_IDS,
        )
        return jsonify(result)
    elif ONLINECOMPILER_API_KEY and not (app.config.get("TESTING") and not os.getenv("TEST_WITH_ONLINECOMPILER")):
        import onlinecompiler_provider
        result = await onlinecompiler_provider.verify_code(
            language,
            code,
            expected,
            api_key=ONLINECOMPILER_API_KEY,
        )
        return jsonify(result)
    else:
        return jsonify({
            "status":"NOT VERIFIED",
            "message":"No isolated code runner is configured. The code was not executed.",
            "details":"Configure JUDGE0_URL or ONLINECOMPILER_API_KEY to enable real execution. This is intentionally not reported as a pass.",
            "runnerDescription":"No isolated runner configured."
        })

def _safe_export_filename(course, ext):
    if not isinstance(course, dict):
        return f"coursekraft_course.{ext}"
    title = str(course.get("title") or "coursekraft_course").strip()
    clean = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in title).strip("_")
    return f"{clean or 'coursekraft_course'}.{ext}"

def validate_export_course(course):
    return validate_course(course)

@app.route("/api/export/prepare", methods=["POST"])
def export_prepare():
    course = request.get_json(silent=True)
    if not course and request.form.get("course"):
        try:
            course = json.loads(request.form.get("course"))
        except Exception:
            course = None
    if not course:
        course = SAMPLE_COURSE
    error = validate_export_course(course)
    if error:
        return jsonify({"error": error}), 400
    
    session["prepared_export_course"] = course
    session.modified = True
    return jsonify({
        "success": True,
        "filename": _safe_export_filename(course, "export"),
    })


@app.route("/api/export/download/<kind>", methods=["GET"])
def export_download(kind):
    if kind not in ("pdf", "pptx"):
        return "Invalid export type", 400
    course = session.get("prepared_export_course") or SAMPLE_COURSE
    try:
        if kind == "pdf":
            output = create_pdf(course)
            filename = _safe_export_filename(course, "pdf")
            response = send_file(
                output,
                as_attachment=True,
                download_name=filename,
                mimetype="application/pdf",
            )
            response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
            return response
        else:
            output = create_pptx(course)
            filename = _safe_export_filename(course, "pptx")
            response = send_file(
                output,
                as_attachment=True,
                download_name=filename,
                mimetype="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            )
            response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
            return response
    except Exception as e:
        app.logger.exception("Export download failed: %s", e)
        return f"Export generation failed: {str(e)}", 500


@app.route("/api/export/pptx", methods=["POST"])
def export_pptx():
    course = request.get_json(silent=True)
    if not course and request.form.get("course"):
        try:
            course = json.loads(request.form.get("course"))
        except Exception:
            course = None
    error = validate_export_course(course)
    if error:
        app.logger.warning("PPTX export validation failed: %s", error)
        return jsonify({"error":error}), 400
    try:
        output = create_pptx(course)
        filename = _safe_export_filename(course, "pptx")
        response = send_file(
            output,
            as_attachment=True,
            download_name=filename,
            mimetype="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        )
        response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
        response.headers["Access-Control-Expose-Headers"] = "Content-Disposition"
        return response
    except Exception as e:
        app.logger.exception("PowerPoint export failed: %s", e)
        return jsonify({"error":"PowerPoint export failed. Check the course content and installed requirements, then retry."}), 500


@app.route("/api/export/pdf", methods=["POST"])
def export_pdf():
    course = request.get_json(silent=True)
    if not course and request.form.get("course"):
        try:
            course = json.loads(request.form.get("course"))
        except Exception:
            course = None
    error = validate_export_course(course)
    if error:
        app.logger.warning("PDF export validation failed: %s", error)
        return jsonify({"error":error}), 400
    try:
        output = create_pdf(course)
        filename = _safe_export_filename(course, "pdf")
        response = send_file(
            output,
            as_attachment=True,
            download_name=filename,
            mimetype="application/pdf",
        )
        response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
        response.headers["Access-Control-Expose-Headers"] = "Content-Disposition"
        return response
    except Exception as e:
        app.logger.exception("PDF export failed: %s", e)
        return jsonify({"error":"PDF export failed. Check the course content and installed requirements, then retry."}), 500

# -------------------------------------------------------------
# TEACHER AUTHENTICATION & ACCOUNT ROUTES
# -------------------------------------------------------------

@app.route("/register", methods=["GET", "POST"])
def register():
    if current_user.is_authenticated:
        return redirect("/")
    if request.method == "POST":
        csrf = request.form.get("csrf_token")
        if not validate_csrf_token(csrf):
            flash("Session expired or invalid submission. Please try again.", "error")
            return render_template("register.html"), 400

        full_name = request.form.get("full_name", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        confirm_password = request.form.get("confirm_password", "")

        if not full_name or len(full_name) > 120:
            flash("Please enter your full name (up to 120 characters).", "error")
            return render_template("register.html"), 400

        email_err = validate_email_format(email)
        if email_err:
            flash(email_err, "error")
            return render_template("register.html"), 400

        pwd_err = validate_password_strength(password)
        if pwd_err:
            flash(pwd_err, "error")
            return render_template("register.html"), 400

        if password != confirm_password:
            flash("Passwords do not match.", "error")
            return render_template("register.html"), 400

        existing = database.db_session.query(User).filter_by(email=email).first()
        if existing:
            flash("An account is already registered with this email address. Please sign in instead.", "error")
            return render_template("register.html"), 400

        new_user = User(full_name=full_name, email=email)
        new_user.set_password(password)
        database.db_session.add(new_user)
        database.db_session.commit()

        login_user(new_user)
        flash(f"Welcome to CourseKraft AI, {new_user.full_name}! Your teacher account is ready.", "success")
        return redirect("/")

    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect("/")
    if request.method == "POST":
        csrf = request.form.get("csrf_token")
        if not validate_csrf_token(csrf):
            flash("Session expired or invalid submission. Please try again.", "error")
            return render_template("login.html"), 400

        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        remember = request.form.get("remember_me") == "true"

        user = database.db_session.query(User).filter_by(email=email).first()
        if not user or not user.check_password(password):
            flash("Invalid email address or password. Please verify your credentials.", "error")
            return render_template("login.html"), 401

        login_user(user, remember=remember)
        flash(f"Welcome back to your atelier, {user.full_name}.", "success")
        next_page = request.args.get("next")
        if next_page and next_page.startswith("/"):
            return redirect(next_page)
        return redirect("/")

    return render_template("login.html")


@app.route("/logout")
def logout():
    if current_user.is_authenticated:
        logout_user()
        flash("You have been signed out safely.", "info")
    return redirect("/login")


@app.route("/forgot-password", methods=["GET", "POST"])
def forgot_password():
    reset_link = None
    if request.method == "POST":
        csrf = request.form.get("csrf_token")
        if not validate_csrf_token(csrf):
            flash("Session expired or invalid submission. Please try again.", "error")
            return render_template("forgot_password.html"), 400

        email = request.form.get("email", "").strip().lower()
        # Secure timed token generated; never reveals whether email is registered
        token = generate_reset_token(email)
        reset_link = url_for("reset_password", token=token, _external=True)
        flash("If an account exists with this email, recovery instructions have been prepared.", "info")

    return render_template("forgot_password.html", reset_link=reset_link)


@app.route("/reset-password/<token>", methods=["GET", "POST"])
def reset_password(token):
    email = verify_reset_token(token)
    if not email:
        flash("This recovery link is invalid or has expired. Please request a new one.", "error")
        return redirect(url_for("forgot_password"))

    user = database.db_session.query(User).filter_by(email=email).first()
    if not user:
        flash("Account not found for this recovery token.", "error")
        return redirect(url_for("login"))

    if request.method == "POST":
        csrf = request.form.get("csrf_token")
        if not validate_csrf_token(csrf):
            flash("Session expired or invalid submission. Please try again.", "error")
            return render_template("reset_password.html", token=token), 400

        password = request.form.get("password", "")
        confirm_password = request.form.get("confirm_password", "")

        pwd_err = validate_password_strength(password)
        if pwd_err:
            flash(pwd_err, "error")
            return render_template("reset_password.html", token=token), 400

        if password != confirm_password:
            flash("Passwords do not match.", "error")
            return render_template("reset_password.html", token=token), 400

        user.set_password(password)
        database.db_session.commit()
        flash("Your password has been updated successfully. Please sign in with your new password.", "success")
        return redirect(url_for("login"))

    return render_template("reset_password.html", token=token)


# -------------------------------------------------------------
# TEACHER PROFILE JSON APIS
# -------------------------------------------------------------

@app.route("/api/auth/me")
def api_auth_me():
    if current_user.is_authenticated:
        return jsonify({
            "authenticated": True,
            **current_user.to_dict()
        })
    return jsonify({
        "authenticated": False,
        "fullName": None,
        "email": None,
        "initials": None,
        "courseCount": 0,
    })


@app.route("/api/auth/update-profile", methods=["POST"])
@login_required
def api_update_profile():
    data = request.get_json(silent=True) or {}
    full_name = str(data.get("fullName", "")).strip()
    if not full_name or len(full_name) > 120:
        return jsonify({"error": "Full name must be between 1 and 120 characters."}), 400

    current_user.full_name = full_name
    database.db_session.commit()
    return jsonify({
        "success": True,
        "message": "Profile updated successfully.",
        "user": current_user.to_dict()
    })


# -------------------------------------------------------------
# PERSISTENT COURSE VAULT APIS
# -------------------------------------------------------------

@app.route("/api/courses", methods=["GET"])
@login_required
def api_list_courses():
    courses = [c.to_dict(full=False) for c in current_user.courses]
    return jsonify({"courses": courses, "count": len(courses)})


@app.route("/api/courses/<course_id>", methods=["GET"])
@login_required
def api_get_course(course_id):
    course = database.db_session.get(Course, course_id)
    if not course:
        return jsonify({"error": "Course not found."}), 404
    if course.user_id != current_user.id:
        return jsonify({"error": "Forbidden: You do not own this course."}), 403
    return jsonify({"course": course.to_dict(full=True)})


@app.route("/api/courses/save", methods=["POST"])
@login_required
def api_save_course():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Course payload must be a JSON object."}), 400

    validation_err = validate_course(data)
    if validation_err:
        return jsonify({"error": validation_err}), 400

    course_id = data.get("id")
    title = str(data.get("title", "Untitled Course")).strip()
    topic = str(data.get("topic", title)).strip()
    level = str(data.get("level", "Beginner"))
    duration = int(data.get("durationMinutes", 45))
    language = str(data.get("language", "Java"))

    existing = None
    if course_id:
        existing = database.db_session.get(Course, course_id)
        if existing and existing.user_id != current_user.id:
            return jsonify({"error": "Forbidden: You cannot modify another teacher's course."}), 403

    if existing:
        existing.title = title
        existing.topic = topic
        existing.level = level
        existing.duration_minutes = duration
        existing.language = language
        existing.set_content(data)
        course_obj = existing
    else:
        course_obj = Course(
            user_id=current_user.id,
            title=title,
            topic=topic,
            level=level,
            duration_minutes=duration,
            language=language,
        )
        course_obj.set_content(data)
        database.db_session.add(course_obj)

    database.db_session.commit()
    return jsonify({
        "success": True,
        "message": f"Course '{course_obj.title}' saved to your vault.",
        "course": course_obj.to_dict(full=True)
    })


@app.route("/api/courses/<course_id>", methods=["PUT"])
@login_required
def api_update_course(course_id):
    course = database.db_session.get(Course, course_id)
    if not course:
        return jsonify({"error": "Course not found."}), 404
    if course.user_id != current_user.id:
        return jsonify({"error": "Forbidden: You do not own this course."}), 403

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid course payload."}), 400

    validation_err = validate_course(data)
    if validation_err:
        return jsonify({"error": validation_err}), 400

    course.title = str(data.get("title", course.title)).strip()
    course.topic = str(data.get("topic", course.topic)).strip()
    course.level = str(data.get("level", course.level))
    course.duration_minutes = int(data.get("durationMinutes", course.duration_minutes))
    course.language = str(data.get("language", course.language))
    course.set_content(data)
    database.db_session.commit()

    return jsonify({
        "success": True,
        "message": "Course updated in your vault.",
        "course": course.to_dict(full=True)
    })


@app.route("/api/courses/<course_id>", methods=["DELETE"])
@login_required
def api_delete_course(course_id):
    course = database.db_session.get(Course, course_id)
    if not course:
        return jsonify({"error": "Course not found."}), 404
    if course.user_id != current_user.id:
        return jsonify({"error": "Forbidden: You cannot delete another teacher's course."}), 403

    title = course.title
    database.db_session.delete(course)
    database.db_session.commit()
    return jsonify({
        "success": True,
        "message": f"Course '{title}' deleted from your vault."
    })


if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "5000"))
    app.run(host=host, port=port, debug=False)
