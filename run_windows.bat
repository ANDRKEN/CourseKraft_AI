@echo off
cd /d "%~dp0"
if not exist .venv (
  py -m venv .venv
)
call .venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt
if not exist .env copy .env.example .env
echo.
echo CourseForge AI will start at http://127.0.0.1:5000
echo Add API keys to .env then restart to enable integrations.
echo.
python app.py
pause
