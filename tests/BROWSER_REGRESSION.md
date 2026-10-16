# Browser regression checklist

Run the API and content-validation suite with `python -m unittest discover -v`, then start the local app with `python app.py` and open `http://127.0.0.1:5000/`.

The repository currently has no Playwright, Selenium, or Puppeteer dependency. These browser checks are therefore manual and should be run after changes to the page, styles, or client-side workflow.

1. Confirm the page shows one provider notice that accurately explains whether AI generation is available. The status pill should not repeat the warning.
2. Choose **Open sample course**. Confirm the fixed Java/OOP content opens with a sample label and the app server log shows `GET /api/sample` without a generation request for that action.
3. Visit Overview, Slides & notes, Code & checks, Exercises & quiz, and Cheat sheet. Confirm each view contains the sample data.
4. Change a slide title, visit Overview, return to Slides & notes, and confirm the edit remains in the current page session.
5. Return to Create course, enter a topic, and submit while Gemini is unconfigured. Confirm the page remains in creation, reports that no course was generated, and keeps the sample action available.
6. Verify the sample code while Judge0 is unconfigured. Confirm the result says **NOT VERIFIED**, and never **PASSED**.
7. Export PDF and PPTX from a loaded sample. Confirm both downloads complete. Invalid export payload behavior is covered by the automated API tests.
8. Inspect the browser console for uncaught JavaScript errors during these actions.
9. Repeat the creation and sample checks at a narrow viewport (about 390px wide) and confirm controls remain reachable without horizontal scrolling.
