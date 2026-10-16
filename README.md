# CourseKraft AI — Local Hackathon MVP

A local-first MVP for the PS5 Verified Course Material Studio. It creates teaching materials, previews slides/notes/quizzes/exercises/cheat sheets, exports PPTX/PDF, and reports code verification honestly.

## Features
- Topic, learner level, duration and language form
- Optional Gemini API generation using `GEMINI_API_KEY`
- Automatic failover to stable Gemini Flash models when the selected model stays overloaded
- Compact generation settings to reduce response time and token use
- Built-in sample course loads separately so the app can be explored without an API key
- AI generation failures are shown as errors; they never silently replace the requested course with sample content
- Slide preview and in-browser editing
- Quiz, exercises and cheat sheet views
- PPTX and PDF export
- Code verification via optional Judge0-compatible isolated runner
- If no runner is configured, code is marked **NOT VERIFIED**; it is never falsely marked passed

## Windows quick start
1. Install Python 3.10+ from https://www.python.org/downloads/ (enable "Add Python to PATH").
2. Extract the ZIP to a folder.
3. Double-click `run_windows.bat`, or run the commands below in PowerShell.
4. Open http://127.0.0.1:5000.

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
copy .env.example .env
python app.py
```

## Enable Gemini (optional)
1. Create a key at https://aistudio.google.com/.
2. Open `.env` in a text editor and set `GEMINI_API_KEY=your_key_here`.
3. Restart the app. Keep `.env` private and never upload it to GitHub.
4. Free-tier access, model availability and quotas can change; check Google AI Studio. The app retries temporary errors and switches models after repeated 5xx overloads.

## Enable real code verification (optional)
Configure `JUDGE0_URL` to a trusted Judge0-compatible service and `JUDGE0_API_KEY` if required. The app supports language IDs for Java, Python 3, JavaScript and C++. Test service availability before the hackathon. Hosted Judge0 providers may require provider-specific headers or settings; adjust `verify()` if necessary.

**Security:** do not expose the local app to the public internet. Do not run untrusted code directly on your computer. Code verification is delegated to the configured execution service. Without one, the result is **NOT VERIFIED**.

## Deploy later
Deploy the Flask app to a Python-capable host. Configure secrets as environment variables, use HTTPS, and add authentication/rate limits before exposing it publicly. Do not commit `.env`.

## Team split
1. UI and integration
2. AI generation/schema
3. Verification service
4. Export/editor
5. QA/demo/presentation

## Current MVP limits
- The built-in sample course is demo content, not a live AI result. It is available separately from AI generation.
- Temporary Gemini HTTP 408, 429, 500, 502, 503 and 504 responses and connection timeouts are retried up to two times with backoff. Invalid model or key errors are reported without retrying.
- Quiz answers are displayed for instructor review; this MVP is not a student exam platform.
- Code runner integration depends on a configured, reachable Judge0-compatible service.
- PDF/PPTX exports are generated locally by the Flask server.
