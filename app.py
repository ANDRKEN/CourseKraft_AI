import os, json
from flask import Flask, render_template, request, jsonify, send_file
from werkzeug.exceptions import RequestEntityTooLarge
from dotenv import load_dotenv
load_dotenv()
from course_validation import MAX_COURSE_BYTES, validate_course, validate_generation_request
from course_exports import create_pdf, create_pptx
import gemini_provider
import judge0_provider

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_COURSE_BYTES
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"
_DEFAULT_GEMINI_FALLBACK_MODELS = ("gemini-3.5-flash-lite", "gemini-3.8-flash")
_fallback_models = os.getenv("GEMINI_FALLBACK_MODELS", "").strip()
GEMINI_FALLBACK_MODELS = (
    tuple(model.strip() for model in _fallback_models.split(",") if model.strip())
    if _fallback_models else _DEFAULT_GEMINI_FALLBACK_MODELS
)
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
        "Apply object-oriented concepts in a small Java program"
    ],
    "slides": [
        {"title":"What is OOP?","bullets":["A programming approach built around objects","Objects combine state (data) and behaviour (methods)","Java supports classes, inheritance, polymorphism and encapsulation"],"speakerNotes":"Start with a real-world example such as a Student object.","visualType":"comparison","visualDescription":"Contrast an object’s state with the operations it can perform.","visualLabels":["State / fields","Behaviour / methods"]},
        {"title":"Classes and Objects","bullets":["A class is a blueprint","An object is an instance of a class","Fields represent state; methods represent behaviour"],"speakerNotes":"Compare a class to a blueprint and objects to actual houses built from it.","visualType":"flowchart","visualDescription":"Show a class blueprint producing concrete object instances.","visualLabels":["Class blueprint","Instantiate","Student object"]},
        {"title":"Encapsulation","bullets":["Keep data and behaviour together","Use access modifiers to control access","Expose safe operations through methods"],"speakerNotes":"Explain why fields are often private and accessed through methods.","visualType":"flowchart","visualDescription":"Illustrate private fields being accessed through a safe public method.","visualLabels":["Private state","Public method","Safe update"]},
        {"title":"Constructors","bullets":["A constructor initializes a new object","Its name matches the class name","It has no return type"],"speakerNotes":"Show a constructor that initializes a student's name and roll number."},
        {"title":"Key Takeaways","bullets":["Classes define structure","Objects are runtime instances","Encapsulation protects internal state","Practise by modelling a real-world entity"],"speakerNotes":"Ask students to describe one class they would create for a library system."}
    ],
    "codeExamples": [
        {"id":"java-001","title":"Class and object example","language":"java","code":"public class Main {\n  static class Student {\n    String name;\n    Student(String name) { this.name = name; }\n  }\n  public static void main(String[] args) {\n    Student s = new Student(\"Asha\");\n    System.out.println(s.name);\n  }\n}","testDescription":"Expected output: Asha","expectedOutput":"Asha"}
    ],
    "exercises": [
        {"title":"Create a Book class","description":"Create a Book class with title and author fields, then create one object and print its title.","difficulty":"Easy","testHint":"The output should include the book title."},
        {"title":"Add a constructor","description":"Add a constructor that initializes the title and author fields.","difficulty":"Medium","testHint":"Create the object using the constructor and print both fields."}
    ],
    "quiz": [
        {"question":"What is a class in Java?","options":["A blueprint for objects","A running process","A database table","A loop"],"correctIndex":0,"explanation":"A class defines the fields and methods that its objects can have."},
        {"question":"Which statement best describes an object?","options":["A package of source files","An instance of a class","A compiler error","A primitive type"],"correctIndex":1,"explanation":"An object is an instance created from a class."},
        {"question":"What is the main purpose of encapsulation?","options":["Make every field public","Control access to internal state","Remove methods","Replace constructors"],"correctIndex":1,"explanation":"Encapsulation groups state and behaviour and controls access to implementation details."}
    ],
    "cheatSheet": [
        {"term":"Class","definition":"A blueprint defining fields and methods."},
        {"term":"Object","definition":"An instance of a class."},
        {"term":"Constructor","definition":"A special member used to initialize a new object."},
        {"term":"Encapsulation","definition":"Bundling data and methods while controlling access."},
        {"term":"Method","definition":"A named block of code that performs an operation."}
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
    return jsonify({"geminiConfigured": bool(GEMINI_API_KEY), "judge0Configured": bool(JUDGE0_URL),
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
    return jsonify({"course":course, "message":message, "source":course["_source"],
                    "generationStatus":"generated"})


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
"cheatSheet": [{{"term": string, "definition": string}}]
}}
Requirements:
- Return JSON only, with no markdown fences. Match the supplied topic, learner level, duration, and language.
- Include 3-5 measurable learning objectives and 7-8 useful slides in a coherent teaching sequence.
- Give each slide 2-4 specific bullets, 40-70 words of trainer notes, and the visual metadata fields above. Use "none" and [] when a visual is not useful; describe a suggested image without claiming one was created.
- Include one or two complete code examples when programming is relevant. Include realistic expected output and a test description, but do not claim the example was executed. Use an empty codeExamples list when programming is not relevant.
- Include two practical exercises with acceptance hints, three quiz questions with four plausible options and explanations, and five or six concise cheat-sheet terms.
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
    if not JUDGE0_URL:
        return jsonify({
            "status":"NOT VERIFIED",
            "message":"No isolated code runner is configured. The code was not executed.",
            "details":"Configure JUDGE0_URL (and JUDGE0_API_KEY if required) to enable real execution. This is intentionally not reported as a pass.",
            "runnerDescription":"No isolated runner configured."
        })
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

def validate_export_course(course):
    return validate_course(course)

@app.route("/api/export/pptx", methods=["POST"])
def export_pptx():
    course = request.get_json(silent=True)
    error = validate_export_course(course)
    if error:
        return jsonify({"error":error}), 400
    try:
        output = create_pptx(course)
        return send_file(
            output,
            as_attachment=True,
            download_name="coursekraft_course.pptx",
            mimetype="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        )
    except Exception:
        return jsonify({"error":"PowerPoint export failed. Check the course content and installed requirements, then retry."}), 500


@app.route("/api/export/pdf", methods=["POST"])
def export_pdf():
    course = request.get_json(silent=True)
    error = validate_export_course(course)
    if error:
        return jsonify({"error":error}), 400
    try:
        output = create_pdf(course)
        return send_file(
            output,
            as_attachment=True,
            download_name="coursekraft_course.pdf",
            mimetype="application/pdf",
        )
    except Exception:
        return jsonify({"error":"PDF export failed. Check the course content and installed requirements, then retry."}), 500
if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("PORT","5000")), debug=False)
