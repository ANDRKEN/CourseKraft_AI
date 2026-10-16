from app import app
import os

# mock GEMINI_API_KEY so it doesn't fail early
os.environ['GEMINI_API_KEY'] = 'fake_key'

if __name__ == '__main__':
    app.run(port=5005, threaded=True)
