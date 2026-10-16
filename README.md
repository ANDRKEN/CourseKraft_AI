# CourseKraft AI — Local Course Studio

A local-first MVP for the PS5 Verified Course Material Studio. It creates teaching materials, previews slides/notes/quizzes/exercises/cheat sheets, exports PPTX/PDF, and reports code verification honestly.

## Features
- Topic, learner level, duration and language form
- Optional topic-specific Gemini generation using `GEMINI_API_KEY`
- Bounded retries and configurable model fallback through `GEMINI_FALLBACK_MODELS`
- Fixed Java/OOP sample loads separately and never substitutes for a failed AI request
- Slide preview and in-browser editing
- Quiz, exercises and cheat sheet views
- PPTX and PDF export
- Code verification via optional Judge0-compatible isolated runner
- If no runner is configured, code is marked **NOT VERIFIED**; it is never falsely marked passed

## Windows quick start
1. Install Python 3.10+ from https://www.python.org/downloads/ (enable "Add Python to PATH").
2. Open the CourseKraft AI project folder.
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
4. `GEMINI_FALLBACK_MODELS` accepts a comma-separated list of model IDs. Connectivity is checked only when you request generation; a configured key does not mean the provider has been reached.

## Enable real code verification (optional)
Configure `JUDGE0_URL` to a trusted Judge0-compatible service. RapidAPI hosts receive their documented key and host headers. For other services, set `JUDGE0_API_KEY_HEADER` to the authentication header the provider documents. If the runner uses different language IDs or supports only a subset, set `JUDGE0_LANGUAGE_IDS` to a JSON object such as `{"python":71,"java":62}`. Without a runner, or when a language is not configured, code remains **NOT VERIFIED**.

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
- The fixed sample is demo content, not a live AI result, and is loaded only through the sample action.
- Generated code and expected output are model-provided examples, not verified execution results.
- Quiz answers are displayed for instructor review; this MVP is not a student exam platform.
- Code runner integration depends on a configured, reachable Judge0-compatible service.
- PDF/PPTX exports are generated locally by the Flask server.
