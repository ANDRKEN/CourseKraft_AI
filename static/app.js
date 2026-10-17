"use strict";

const $ = (id) => document.getElementById(id);
const state = { course: null, view: "create", selectedSlide: 0, selectedCode: 0, busy: false };
let providerNoticeMessage = "";
let paperSceneInstance = null;
let paperSceneModulePromise = null;
let paperMotionEnabled = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let paperSceneNearViewport = false;

const views = {
  create: ["Create a course", "Shape a focused teaching session, then review every material before sharing it."],
  overview: ["Course overview", "Review the course details and the materials returned for this session."],
  slides: ["Slides & trainer notes", "Edit the teaching sequence and trainer notes for this session."],
  code: ["Code & checks", "Inspect code examples and check execution with a configured isolated runner."],
  practice: ["Exercises & quiz", "Review the practice activities and knowledge check included with this course."],
  cheat: ["Cheat sheet", "Review the quick reference terms and definitions included with this course."]
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function toast(message) {
  const node = $("toast");
  if (!node) return;
  node.textContent = message;
  node.classList.add("show");
  window.setTimeout(() => node.classList.remove("show"), 3200);
}

function setNotice(message = "", kind = "status") {
  const node = $("providerNotice");
  if (!node) return;
  node.textContent = message;
  node.hidden = !message;
  node.setAttribute("role", kind === "error" ? "alert" : "status");
  node.setAttribute("aria-live", kind === "error" ? "assertive" : "polite");
  node.classList.toggle("alert-warning", kind === "error" || kind === "warning");
}

async function requestJson(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
  if (csrfToken && ["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
    options.headers = {
      ...(options.headers || {}),
      "X-CSRFToken": csrfToken
    };
  }
  const response = await fetch(url, options);
  let data;
  try { data = await response.json(); }
  catch { throw new Error(`The server returned an unreadable response (${response.status}).`); }
  if (!response.ok) throw new Error(data.error || data.message || `Request failed (${response.status}).`);
  return data;
}

function saveCurrentSlide() {
  const slides = state.course?.slides || [];
  const slide = slides[state.selectedSlide];
  if (!slide || $("slideEditFields").hidden) return;
  slide.title = $("slideTitle").value;
  slide.bullets = $("slideBullets").value.split("\n").map((line) => line.trim()).filter(Boolean);
  slide.speakerNotes = $("slideNotes").value;
}

function saveCurrentCode() {
  const code = (state.course?.codeExamples || [])[state.selectedCode];
  if (!code || $("codeContent").hidden) return;
  code.code = $("codeEditor").value;
  code.expectedOutput = $("expectedOutput").value;
}

function showView(view) {
  if (!views[view]) return;
  if (state.course) {
    saveCurrentSlide();
    saveCurrentCode();
  }
  if (view !== "create" && !state.course) view = "create";
  state.view = view;
  $("courseState").hidden = view === "create" || !state.course;
  $("generateBtn").hidden = view !== "create";
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("active-panel", panel.id === view);
  });
  document.querySelectorAll(".nav[data-view]").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  $("pageTitle").textContent = state.course && view !== "create" ? (state.course.title || views[view][0]) : views[view][0];
  $("pageDescription").textContent = views[view][1];
}

function setCourse(course, sourceLabel) {
  const validationError = validateCourseContent(course);
  if (validationError) throw new Error(`Course content is invalid: ${validationError}`);
  state.course = course;
  state.selectedSlide = 0;
  state.selectedCode = 0;
  setNotice(providerNoticeMessage);
  $("courseNavigation").hidden = false;
  $("workspaceExports").hidden = false;
  $("sidebarCourseTitle").textContent = course.title || "Untitled course";
  $("sidebarCourseMeta").textContent = [course.level, course.durationMinutes ? `${course.durationMinutes} min` : "", course.language].filter(Boolean).join(" · ");
  const sampleCourse = course._source === "Sample content";
  $("courseState").textContent = sampleCourse ? "SAMPLE · LOCAL SESSION" : "AI DRAFT · REVIEW";
  $("courseState").dataset.kind = sampleCourse ? "sample" : "generated";
  $("courseState").hidden = false;
  $("courseSourceNotice").textContent = sourceLabel;
  $("courseSourceNotice").dataset.source = course._source === "Sample content" ? "sample" : "generated";
  renderAll();
  showView("overview");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function validateCourseContent(course) {
  if (!course || typeof course !== "object" || Array.isArray(course)) return "expected a course object.";
  const text = (value, path, max, required = false) => {
    if (value === undefined && !required) return null;
    if (typeof value !== "string") return `${path} must be text.`;
    if (required && !value.trim()) return `${path} must not be empty.`;
    if (value.length > max) return `${path} is too long.`;
    return null;
  };
  const list = (value, path, limit, itemCheck, required = true, minimum = 0) => {
    if (value === undefined && !required) return null;
    if (!Array.isArray(value)) return `${path} must be a list.`;
    if (value.length > limit) return `${path} has too many items.`;
    if (value.length < minimum) return `${path} must contain at least ${minimum} items.`;
    for (let index = 0; index < value.length; index += 1) {
      const error = itemCheck(value[index], `${path}[${index}]`);
      if (error) return error;
    }
    return null;
  };
  const object = (item, path) => item && typeof item === "object" && !Array.isArray(item)
    ? null : `${path} must be an object.`;
  const checkTextList = (value, path, limit, max, minimum = 0) => list(value, path, limit,
    (item, itemPath) => text(item, itemPath, max, true), true, minimum);
  const fields = [
    ["title", 180, true], ["topic", 180, false], ["level", 50, false], ["language", 40, false]
  ];
  for (const [name, max, required] of fields) {
    const error = text(course[name], name, max, required);
    if (error) return error;
  }
  if (course.durationMinutes !== undefined && (!Number.isInteger(course.durationMinutes) || course.durationMinutes < 1 || course.durationMinutes > 240)) {
    return "durationMinutes must be a whole number from 1 to 240.";
  }
  let error = checkTextList(course.objectives, "objectives", 30, 500);
  if (error && course.objectives !== undefined) return error;
  error = list(course.slides, "slides", 60, (slide, path) => {
    const objectError = object(slide, path);
    if (objectError) return objectError;
    return text(slide.title, `${path}.title`, 240, true)
      || checkTextList(slide.bullets, `${path}.bullets`, 40, 4000)
      || text(slide.speakerNotes, `${path}.speakerNotes`, 12000)
      || text(slide.visualType, `${path}.visualType`, 40)
      || text(slide.visualDescription, `${path}.visualDescription`, 2000)
      || (slide.visualLabels === undefined ? null : checkTextList(slide.visualLabels, `${path}.visualLabels`, 8, 200));
  });
  if (error) return error;
  error = list(course.codeExamples, "codeExamples", 30, (item, path) => {
    const objectError = object(item, path);
    if (objectError) return objectError;
    return text(item.title, `${path}.title`, 240, true)
      || text(item.language, `${path}.language`, 40, true)
      || text(item.code, `${path}.code`, 12000, true)
      || text(item.testDescription, `${path}.testDescription`, 2000)
      || text(item.expectedOutput, `${path}.expectedOutput`, 4000);
  });
  if (error) return error;
  error = list(course.exercises, "exercises", 60, (item, path) => {
    const objectError = object(item, path);
    if (objectError) return objectError;
    return text(item.title, `${path}.title`, 240, true)
      || text(item.description, `${path}.description`, 4000, true)
      || text(item.difficulty, `${path}.difficulty`, 40)
      || text(item.testHint, `${path}.testHint`, 2000);
  });
  if (error) return error;
  error = list(course.quiz, "quiz", 100, (item, path) => {
    const objectError = object(item, path);
    if (objectError) return objectError;
    const questionError = text(item.question, `${path}.question`, 2000, true);
    if (questionError) return questionError;
    const optionsError = checkTextList(item.options, `${path}.options`, 8, 1000, 2);
    if (optionsError) return optionsError;
    if (!Number.isInteger(item.correctIndex) || item.correctIndex < 0 || item.correctIndex >= item.options.length) return `${path}.correctIndex must refer to an available option.`;
    return text(item.explanation, `${path}.explanation`, 3000);
  });
  if (error) return error;
  return list(course.cheatSheet, "cheatSheet", 100, (item, path) => {
    const objectError = object(item, path);
    if (objectError) return objectError;
    return text(item.term, `${path}.term`, 240, true)
      || text(item.definition, `${path}.definition`, 3000, true);
  });
}

function emptyMarkup(message) { return `<p class="empty-copy">${esc(message)}</p>`; }

function renderOverview() {
  const course = state.course;
  $("overviewTitle").textContent = course.title || "Untitled course";
  $("overviewMeta").textContent = [course.topic, course.level, course.durationMinutes ? `${course.durationMinutes} minutes` : "", course.language].filter(Boolean).join(" · ");
  const objectives = Array.isArray(course.objectives) ? course.objectives : [];
  $("overviewObjectives").innerHTML = objectives.length
    ? objectives.map((item) => `<li>${esc(item)}</li>`).join("")
    : emptyMarkup("No learning objectives were returned.");
  const counts = [
    ["Slides", course.slides], ["Code examples", course.codeExamples], ["Exercises", course.exercises], ["Quiz questions", course.quiz], ["Reference terms", course.cheatSheet]
  ].map(([label, items]) => `<div class="count-item"><b>${Array.isArray(items) ? items.length : 0}</b><span>${label}</span></div>`).join("");
  $("overviewCounts").innerHTML = counts;
  const slides = Array.isArray(course.slides) ? course.slides : [];
  $("overviewSlidePreview").innerHTML = slides.length
    ? slides.slice(0, 4).map((slide, index) => `<article class="preview-slide"><span>${String(index + 1).padStart(2, "0")}</span><h4>${esc(slide.title || "Untitled slide")}</h4><p>${esc((slide.bullets || [])[0] || "No key point supplied.")}</p></article>`).join("")
    : emptyMarkup("No slides were returned for this course.");
}

function renderOutline() {
  const slides = Array.isArray(state.course.slides) ? state.course.slides : [];
  $("courseOutline").innerHTML = slides.length
    ? slides.map((slide, index) => `<button type="button" class="outline-item" data-outline-slide="${index}"><span>${String(index + 1).padStart(2, "0")}</span>${esc(slide.title || "Untitled slide")}</button>`).join("")
    : emptyMarkup("No slides yet.");
  document.querySelectorAll("[data-outline-slide]").forEach((button) => button.addEventListener("click", () => {
    saveCurrentSlide();
    state.selectedSlide = Number(button.dataset.outlineSlide);
    showView("slides");
    renderSlides();
  }));
}

function renderVisualDiagram(slide) {
  const container = $("slideVisualDiagram");
  if (!container) return;
  const labels = Array.isArray(slide.visualLabels) && slide.visualLabels.length
    ? slide.visualLabels
    : ["Input", "Core Process", "Target Output"];
  const type = String(slide.visualType || "flowchart").toLowerCase();

  if (type === "comparison") {
    container.innerHTML = `
      <div style="display:flex;gap:14px;align-items:stretch;">
        <div style="flex:1;background:#fbfafd;border:1.5px solid #d4ccff;border-radius:8px;padding:12px;">
          <b style="color:#432ac9;font-size:0.82rem;display:block;margin-bottom:4px;">${esc(labels[0] || "Component A")}</b>
          <span style="font-size:0.75rem;color:#64667d;">Primary state / structure</span>
        </div>
        <div style="display:flex;align-items:center;color:#f29e85;font-weight:800;font-size:0.85rem;">VS</div>
        <div style="flex:1;background:#fff8f6;border:1.5px solid #fecaca;border-radius:8px;padding:12px;">
          <b style="color:#7a3826;font-size:0.82rem;display:block;margin-bottom:4px;">${esc(labels[1] || "Component B")}</b>
          <span style="font-size:0.75rem;color:#64667d;">Counterpart / method</span>
        </div>
      </div>
    `;
  } else if (type === "timeline" || type === "process") {
    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;position:relative;padding:8px 6px;">
        <div style="position:absolute;top:18px;left:24px;right:24px;height:2px;background:#e2dcd2;z-index:0;"></div>
        ${labels.map((lbl, idx) => `
          <div style="position:relative;z-index:1;text-align:center;">
            <div style="width:24px;height:24px;border-radius:50%;background:#6f54f7;color:#fff;font-size:0.68rem;font-weight:700;display:grid;place-items:center;margin:0 auto 4px;box-shadow:0 0 0 3px #fff;">${idx + 1}</div>
            <span style="font-size:0.72rem;font-weight:600;color:#0d0f1d;max-width:85px;display:inline-block;">${esc(lbl)}</span>
          </div>
        `).join("")}
      </div>
    `;
  } else {
    // Flowchart / Architecture
    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;overflow-x:auto;padding:6px 0;">
        ${labels.map((lbl, idx) => `
          <div style="background:#ffffff;border:1.5px solid #6f54f7;border-radius:6px;padding:6px 12px;font-size:0.78rem;font-weight:600;color:#0d0f1d;box-shadow:0 2px 8px rgba(111,84,247,0.1);white-space:nowrap;">
            ${esc(lbl)}
          </div>
          ${idx < labels.length - 1 ? `<span style="color:#6f54f7;font-weight:800;font-size:1rem;">→</span>` : ""}
        `).join("")}
      </div>
    `;
  }
}

function renderSlides() {
  const slides = Array.isArray(state.course.slides) ? state.course.slides : [];
  $("slideCount").textContent = `${slides.length} ${slides.length === 1 ? "slide" : "slides"}`;
  $("slideNavCount").textContent = slides.length;
  $("slideList").innerHTML = slides.length
    ? slides.map((slide, index) => `<button type="button" class="slide-item ${index === state.selectedSlide ? "selected" : ""}" data-slide="${index}" aria-current="${index === state.selectedSlide ? "true" : "false"}"><span class="slide-thumb">${String(index + 1).padStart(2, "0")}</span><span><b>${esc(slide.title || "Untitled slide")}</b><small>${(slide.bullets || []).length} key points</small></span></button>`).join("")
    : emptyMarkup("No slides were returned for this course.");
  $("slideEmpty").hidden = slides.length > 0;
  $("slideEditFields").hidden = slides.length === 0;
  if (!slides.length) return;
  state.selectedSlide = Math.max(0, Math.min(state.selectedSlide, slides.length - 1));
  const slide = slides[state.selectedSlide];
  $("slideNumber").textContent = `SLIDE ${String(state.selectedSlide + 1).padStart(2, "0")}`;
  $("slideTitle").value = slide.title || "";
  $("slideBullets").value = (slide.bullets || []).join("\n");
  $("slideNotes").value = slide.speakerNotes || "";
  const labels = Array.isArray(slide.visualLabels) ? slide.visualLabels : [];
  const hasVisualGuidance = Boolean(slide.visualDescription || labels.length || (slide.visualType && slide.visualType !== "none"));
  $("slideVisualPreview").hidden = !hasVisualGuidance;
  $("slideVisualType").textContent = slide.visualType && slide.visualType !== "none"
    ? `Suggested ${slide.visualType}` : "Visual suggestion";
  $("slideVisualDescription").textContent = slide.visualDescription || "No visual description was supplied.";
  $("slideVisualLabels").innerHTML = labels.map((label) => `<li>${esc(label)}</li>`).join("");

  if (hasVisualGuidance) {
    renderVisualDiagram(slide);
  }

  document.querySelectorAll("[data-slide]").forEach((button) => button.addEventListener("click", () => {
    saveCurrentSlide();
    state.selectedSlide = Number(button.dataset.slide);
    renderSlides();
  }));
}

function setVerification(status, message, details = "") {
  const normalized = ["PASSED", "FAILED"].includes(status) ? status : "NOT VERIFIED";
  const box = $("verifyResult");
  box.className = `verify-result ${normalized === "PASSED" ? "pass-result" : normalized === "FAILED" ? "fail-result" : "neutral-result"}`;
  const mark = normalized === "PASSED" ? "✓" : normalized === "FAILED" ? "!" : "?";
  box.innerHTML = `<div class="result-mark" aria-hidden="true">${mark}</div><div><b>${esc(normalized)} · ${esc(message)}</b><p>${esc(details)}</p></div>`;
}

function renderCodes(resetResult = true) {
  const examples = Array.isArray(state.course.codeExamples) ? state.course.codeExamples : [];
  $("codeNavCount").textContent = examples.length;
  $("codeEmpty").hidden = examples.length > 0;
  $("codeContent").hidden = examples.length === 0;
  if (!examples.length) return;
  state.selectedCode = Math.max(0, Math.min(state.selectedCode, examples.length - 1));
  $("codeSelect").innerHTML = examples.map((item, index) => `<option value="${index}">${esc(item.title || `Code example ${index + 1}`)}</option>`).join("");
  $("codeSelect").value = String(state.selectedCode);
  const example = examples[state.selectedCode];
  $("codeLang").textContent = (example.language || state.course.language || "code").toUpperCase();
  $("codeTestDescription").textContent = example.testDescription ? `Test description: ${example.testDescription}` : "";
  $("codeTestDescription").hidden = !example.testDescription;
  $("codeEditor").value = example.code || "";
  $("expectedOutput").value = example.expectedOutput || "";
  if (resetResult) setVerification("NOT VERIFIED", "Not verified yet", "A configured isolated runner is required for execution. No verification claim has been made.");
}

function renderPractice() {
  const exercises = Array.isArray(state.course.exercises) ? state.course.exercises : [];
  const quiz = Array.isArray(state.course.quiz) ? state.course.quiz : [];
  $("practiceNavCount").textContent = exercises.length + quiz.length;
  $("exerciseCount").textContent = `${exercises.length} ${exercises.length === 1 ? "exercise" : "exercises"}`;
  $("exerciseList").innerHTML = exercises.length ? exercises.map((item) => `
    <article class="exercise">
      <span class="difficulty">${esc(item.difficulty || "Practice")}</span>
      <h4>${esc(item.title || "Untitled exercise")}</h4>
      <p>${esc(item.description || "No description supplied.")}</p>
      ${item.testHint ? `<p style="margin-top:8px;"><b>Acceptance hint:</b> ${esc(item.testHint)}</p>` : ""}
    </article>`).join("") : emptyMarkup("No exercises were returned for this course.");
  $("quizCount").textContent = `${quiz.length} ${quiz.length === 1 ? "question" : "questions"}`;
  $("quizList").innerHTML = quiz.length ? quiz.map((item, index) => {
    const options = Array.isArray(item.options) ? item.options : [];
    const answer = Number.isInteger(item.correctIndex) ? options[item.correctIndex] : "Not supplied";
    return `
      <article class="quiz-item">
        <span class="q-num">QUESTION ${String(index + 1).padStart(2, "0")}</span>
        <h4>${esc(item.question || "Question")}</h4>
        <ol type="A">${options.map((option) => `<li>${esc(option)}</li>`).join("")}</ol>
        <div class="answer-key"><b>Instructor Answer:</b> ${esc(answer || "Not supplied")}<br>${esc(item.explanation || "")}</div>
      </article>`;
  }).join("") : emptyMarkup("No quiz questions were returned for this course.");
}

function renderCheat() {
  const items = Array.isArray(state.course.cheatSheet) ? state.course.cheatSheet : [];
  $("cheatNavCount").textContent = items.length;
  $("cheatTitle").textContent = state.course.title || "Cheat sheet";
  $("cheatGrid").innerHTML = items.length ? items.map((item) => `
    <article class="term">
      <b>${esc(item.term || "Term")}</b>
      <p>${esc(item.definition || "No definition supplied.")}</p>
    </article>`).join("") : emptyMarkup("No reference terms were returned for this course.");
}

function renderAll() {
  renderOverview();
  renderOutline();
  renderSlides();
  renderCodes();
  renderPractice();
  renderCheat();
}

async function refreshStatus() {
  try {
    const status = await requestJson("/api/status");
    $("aiStatus").textContent = status.geminiConfigured ? `Gemini configured · not tested` : "Local mode";
    $("aiStatus").className = `pill ${status.geminiConfigured ? "purple" : "neutral"}`;
    providerNoticeMessage = status.geminiConfigured
      ? "Gemini is configured. Requests are sent only when you choose Generate; review every draft before use."
      : "Gemini generation is unavailable because GEMINI_API_KEY is not set for this server. Set it privately in .env, then restart the app. The fixed sample below works without Gemini.";
    setNotice(providerNoticeMessage, status.geminiConfigured ? "status" : "warning");
    $("runnerStatus").textContent = status.judge0Configured ? "Runner configured" : "No runner configured";
    $("runnerStatus").className = `pill ${status.judge0Configured ? "purple" : "neutral"}`;
  } catch {
    $("aiStatus").textContent = "Provider status unavailable";
    $("aiStatus").className = "pill neutral";
    providerNoticeMessage = "Could not check provider status. You can still open the local sample course.";
    setNotice(providerNoticeMessage, "warning");
    $("runnerStatus").textContent = "Runner status unavailable";
  }
}

async function generateCourse(event) {
  event.preventDefault();
  if (state.busy) return;
  const topic = $("topic").value.trim();
  if (!topic) { setNotice("Enter a topic before requesting course material.", "error"); $("topic").focus(); return; }
  state.busy = true;
  const buttons = [$("generateBtn"), $("generateFormBtn")];
  buttons.forEach((button) => {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = "Generating course materials…";
  });
  setNotice("");
  paperSceneInstance?.triggerPulse();

  try {
    const data = await requestJson("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        level: $("level").value,
        durationMinutes: Number($("duration").value),
        language: $("language").value
      })
    });
    setCourse(data.course, data.message || "Generated with Gemini AI. Review this draft before using it.");
    if (data.course_id && state.course) {
      state.course.id = data.course_id;
    }
    if (data.saved) {
      toast("Course automatically saved to your persistent vault.");
      try {
        const countRes = await requestJson("/api/courses");
        const len = countRes.courses ? countRes.courses.length : 0;
        if ($("menuCourseCount")) $("menuCourseCount").textContent = len;
        if ($("profileModalCourseCount")) $("profileModalCourseCount").textContent = len;
        const teacherRole = document.querySelector(".teacher-role");
        if (teacherRole) teacherRole.innerHTML = `Teacher &bull; ${len} saved`;
      } catch { /* Silent */ }
    }
  } catch (error) {
    setNotice(`${error.message} No course was generated. The fixed sample below is available if you want to explore the workspace.`, "error");
  } finally {
    state.busy = false;
    buttons.forEach((button) => {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    });
    $("generateBtn").innerHTML = '<span aria-hidden="true">✳</span> Create teaching draft <span class="btn-arrow" aria-hidden="true">↗</span>';
    $("generateFormBtn").innerHTML = '<span aria-hidden="true">✳</span> Generate course materials <span class="btn-arrow" aria-hidden="true">↗</span>';
  }
}

async function loadSample() {
  const button = $("loadSampleBtn");
  button.disabled = true;
  paperSceneInstance?.triggerPulse();
  try {
    const data = await requestJson("/api/sample");
    setCourse(data.course, `${data.message} This fixed sample is not adapted to your topic.`);
  } catch (error) {
    setNotice(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function verifyCode() {
  const example = (state.course?.codeExamples || [])[state.selectedCode];
  if (!example) return;
  saveCurrentCode();
  const button = $("verifyBtn");
  button.disabled = true;
  button.textContent = "Checking runner…";
  setVerification("NOT VERIFIED", "Checking execution service", "Waiting for a real isolated runner response. This request does not execute code in the Flask app.");
  try {
    const result = await requestJson("/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language: example.language || state.course.language,
        code: example.code,
        expectedOutput: example.expectedOutput || ""
      })
    });
    const details = [
      result.runnerDescription,
      result.details,
      result.runnerStatus ? `Runner status: ${result.runnerStatus}` : "",
      result.stdout !== undefined ? `Actual output: ${result.stdout}` : "",
      result.stderr ? `Error output: ${result.stderr}` : "",
      result.expectedOutput ? `Expected output: ${result.expectedOutput}` : ""
    ].filter(Boolean).join("\n");
    setVerification(result.status, result.message || "Runner response received.", details);
  } catch (error) {
    setVerification("NOT VERIFIED", "Verification request failed", `${error.message} The code was not confirmed as passing.`);
  } finally {
    button.disabled = false;
    button.textContent = "▶ Verify with runner";
  }
}

async function downloadExport(kind, button) {
  if (!state.course) return;
  saveCurrentSlide();
  saveCurrentCode();
  const original = button.textContent;
  button.disabled = true;
  button.textContent = `Preparing ${kind.toUpperCase()}…`;
  try {
    const response = await fetch(kind === "pdf" ? "/api/export/pdf" : "/api/export/pptx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.course)
    });
    if (!response.ok) {
      let message = `Export failed (${response.status}).`;
      try { const data = await response.json(); message = data.error || message; } catch { /* Keep status message. */ }
      throw new Error(message);
    }

    // Determine filename: prefer Content-Disposition from server, fallback to sanitized course title
    let filename = "";
    const disposition = response.headers.get("Content-Disposition") || response.headers.get("content-disposition");
    if (disposition) {
      const match = disposition.match(/filename\*?=['"]?(?:UTF-\d['"]*)?([^;\r\n"']*)['"]?/i);
      if (match && match[1]) filename = decodeURIComponent(match[1].trim());
    }
    if (!filename || !filename.endsWith(`.${kind}`)) {
      const cleanTitle = (state.course?.title || "coursekraft_course")
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "") || "coursekraft_course";
      filename = `${cleanTitle}.${kind}`;
    }

    const mimeType = kind === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.presentationml.presentation";

    const rawBlob = await response.blob();

    // Use File constructor so Chromium/Edge embeds filename directly in object metadata
    let downloadItem;
    try {
      downloadItem = new File([rawBlob], filename, { type: mimeType });
    } catch {
      downloadItem = new Blob([rawBlob], { type: mimeType });
    }

    const objectUrl = URL.createObjectURL(downloadItem);
    const anchor = document.createElement("a");
    anchor.style.position = "fixed";
    anchor.style.left = "-9999px";
    anchor.style.opacity = "0";
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.setAttribute("download", filename);
    document.body.appendChild(anchor);

    // Trigger download with click
    anchor.click();

    // Do NOT revoke immediately! Keep URL valid for 2 minutes so Edge SmartScreen
    // has time to inspect the file without reverting the filename to a blob UUID
    window.setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    }, 120000);

    toast(`${kind.toUpperCase()} export downloaded as ${filename}`);
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function updateMotionToggle() {
  const button = $("motionToggle");
  if (!button) return;
  button.setAttribute("aria-pressed", String(paperMotionEnabled));
  button.setAttribute("aria-label", paperMotionEnabled ? "Turn motion off" : "Turn motion on");
  button.querySelector("span:last-child").textContent = paperMotionEnabled ? "Motion on" : "Motion off";
}

async function startPaperScene() {
  if (!paperMotionEnabled || !paperSceneNearViewport || paperSceneInstance) return;
  if (window.matchMedia("(max-width: 620px)").matches || (navigator.deviceMemory && navigator.deviceMemory <= 2)) return;
  try {
    paperSceneModulePromise ||= import("/static/paper-scene.js");
    const sceneModule = await paperSceneModulePromise;
    if (!paperMotionEnabled || paperSceneInstance) return;
    paperSceneInstance = sceneModule.createPaperScene($("paperScene"));
    // Sync initial form values
    if (paperSceneInstance) {
      paperSceneInstance.setLanguage($("language")?.value);
      paperSceneInstance.setDuration($("duration")?.value);
      if ($("topic")?.value) paperSceneInstance.setTopic($("topic").value);
    }
  } catch {
    const button = $("motionToggle");
    if (button) button.hidden = true;
    $("paperScene").dataset.fallback = "true";
  }
}

function initializePaperScene() {
  const region = $("paperScene");
  const button = $("motionToggle");
  if (!region || !button) return;
  updateMotionToggle();
  if (window.matchMedia("(max-width: 620px)").matches || (navigator.deviceMemory && navigator.deviceMemory <= 2)) {
    button.hidden = true;
    region.dataset.fallback = "true";
    return;
  }
  button.addEventListener("click", () => {
    paperMotionEnabled = !paperMotionEnabled;
    updateMotionToggle();
    if (paperMotionEnabled) startPaperScene();
    else if (paperSceneInstance) {
      paperSceneInstance.dispose();
      paperSceneInstance = null;
    }
  });
  if (!("IntersectionObserver" in window) || !window.WebGLRenderingContext) {
    button.hidden = true;
    region.dataset.fallback = "true";
    return;
  }
  const loaderObserver = new IntersectionObserver((entries) => {
    paperSceneNearViewport = entries.some((entry) => entry.isIntersecting);
    if (paperSceneNearViewport) startPaperScene();
  }, { rootMargin: "160px", threshold: 0.01 });
  loaderObserver.observe(region);
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener?.("change", (event) => {
    if (event.matches && paperMotionEnabled) {
      paperMotionEnabled = false;
      updateMotionToggle();
      paperSceneInstance?.dispose();
      paperSceneInstance = null;
    }
  });
}

// Hook form inputs to real-time 3D feedback
$("topic")?.addEventListener("input", (e) => {
  paperSceneInstance?.setTopic(e.target.value);
});
$("language")?.addEventListener("change", (e) => {
  paperSceneInstance?.setLanguage(e.target.value);
});
$("duration")?.addEventListener("change", (e) => {
  paperSceneInstance?.setDuration(e.target.value);
});

// Setup quick topic chips
document.querySelectorAll(".topic-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const topicInput = $("topic");
    if (topicInput) {
      topicInput.value = chip.dataset.topic;
      topicInput.focus();
      paperSceneInstance?.setTopic(topicInput.value);
      toast(`Selected: ${chip.dataset.topic}`);
    }
  });
});

document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
$("generateForm").addEventListener("submit", generateCourse);
$("loadSampleBtn").addEventListener("click", loadSample);
$("saveSlide").addEventListener("click", () => {
  saveCurrentSlide();
  renderSlides();
  renderOverview();
  renderOutline();
  toast("Slide changes saved for this session.");
});
$("codeSelect").addEventListener("change", () => {
  saveCurrentCode();
  state.selectedCode = Number($("codeSelect").value);
  renderCodes();
});
$("verifyBtn").addEventListener("click", verifyCode);
$("exportPptx").addEventListener("click", (event) => downloadExport("pptx", event.currentTarget));
$("exportPdfTop").addEventListener("click", (event) => downloadExport("pdf", event.currentTarget));

refreshStatus();
initializePaperScene();

// ==========================================================================
// TEACHER ACCOUNT & PERSISTENT VAULT INTERACTIONS
// ==========================================================================

function openModal(modalId) {
  closeModals();
  const modal = $(modalId);
  const backdrop = $("modalBackdrop");
  if (!modal || !backdrop) return;
  backdrop.hidden = false;
  modal.hidden = false;
  const focusable = modal.querySelector("input:not([disabled]), button:not([disabled])");
  focusable?.focus();
}

function closeModals() {
  const backdrop = $("modalBackdrop");
  if (backdrop) backdrop.hidden = true;
  document.querySelectorAll(".modal-dialog").forEach((m) => {
    m.hidden = true;
  });
}

function closeProfileDropdown() {
  const menu = $("teacherDropdownMenu");
  const btn = $("profileDropdownBtn");
  if (menu) menu.hidden = true;
  if (btn) btn.setAttribute("aria-expanded", "false");
}

function toggleProfileDropdown() {
  const menu = $("teacherDropdownMenu");
  const btn = $("profileDropdownBtn");
  if (!menu || !btn) return;
  const isHidden = menu.hidden;
  menu.hidden = !isHidden;
  btn.setAttribute("aria-expanded", String(isHidden));
}

async function loadTeacherProfile() {
  try {
    const data = await requestJson("/api/auth/me");
    if (!data.authenticated) return;
    if ($("profileModalName")) $("profileModalName").textContent = data.fullName;
    if ($("profileModalEmail")) $("profileModalEmail").textContent = data.email;
    if ($("profileModalAvatar")) $("profileModalAvatar").textContent = data.initials || "T";
    if ($("profileModalCourseCount")) $("profileModalCourseCount").textContent = data.courseCount ?? 0;
    if ($("menuCourseCount")) $("menuCourseCount").textContent = data.courseCount ?? 0;
  } catch (err) {
    console.error("Could not load teacher profile:", err);
  }
}

async function loadSavedCourses() {
  const loading = $("myCoursesLoading");
  const empty = $("myCoursesEmpty");
  const list = $("myCoursesList");
  if (!loading || !empty || !list) return;

  loading.hidden = false;
  empty.hidden = true;
  list.hidden = true;
  list.innerHTML = "";

  try {
    const data = await requestJson("/api/courses");
    const courses = data.courses || [];
    loading.hidden = true;

    if ($("menuCourseCount")) $("menuCourseCount").textContent = courses.length;
    if ($("profileModalCourseCount")) $("profileModalCourseCount").textContent = courses.length;
    const teacherRole = document.querySelector(".teacher-role");
    if (teacherRole) teacherRole.innerHTML = `Teacher &bull; ${courses.length} saved`;

    if (courses.length === 0) {
      empty.hidden = false;
      return;
    }

    list.innerHTML = courses.map((c) => {
      const updatedDate = c.updatedAt
        ? new Date(c.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
        : (c.createdAt ? new Date(c.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
      return `
        <div class="saved-course-card" data-course-id="${esc(c.id)}">
          <div class="saved-course-info">
            <b>${esc(c.title || "Untitled Course")}</b>
            <div class="saved-course-meta">
              <span class="pill purple">${esc(c.language || "General")}</span>
              <span>${esc(c.level || "Intermediate")}</span>
              <span>&bull;</span>
              <span>${c.durationMinutes || 45} mins</span>
              ${updatedDate ? `<span>&bull;</span><small>Saved ${esc(updatedDate)}</small>` : ""}
            </div>
          </div>
          <div class="saved-course-actions">
            <button type="button" class="btn btn-primary btn-sm btn-open-course" data-open-id="${esc(c.id)}">Open in Atelier</button>
            <button type="button" class="btn-danger-sm btn-delete-course" data-delete-id="${esc(c.id)}" data-title="${esc(c.title)}">Delete</button>
          </div>
        </div>
      `;
    }).join("");

    list.hidden = false;

    list.querySelectorAll(".btn-open-course").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.openId;
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Loading…";
        try {
          const res = await requestJson(`/api/courses/${id}`);
          if (res.course) {
            setCourse(res.course, "Loaded from persistent vault.");
            if (state.course) state.course.id = id;
            showView("overview");
            closeModals();
            toast(`Course "${res.course.title}" loaded from your vault.`);
          }
        } catch (err) {
          toast(`Failed to load course: ${err.message}`);
        } finally {
          btn.disabled = false;
          btn.textContent = originalText;
        }
      });
    });

    list.querySelectorAll(".btn-delete-course").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.deleteId;
        const title = btn.dataset.title;
        if (!window.confirm(`Are you sure you want to delete "${title}" from your vault? This cannot be undone.`)) {
          return;
        }
        btn.disabled = true;
        btn.textContent = "Deleting…";
        try {
          await requestJson(`/api/courses/${id}`, { method: "DELETE" });
          toast(`"${title}" deleted from vault.`);
          loadSavedCourses();
        } catch (err) {
          toast(`Delete failed: ${err.message}`);
          btn.disabled = false;
          btn.textContent = "Delete";
        }
      });
    });

  } catch (err) {
    loading.hidden = false;
    loading.textContent = `Could not load saved courses: ${err.message}`;
  }
}

async function saveActiveCourse() {
  if (!state.course) {
    toast("No active course to save. Generate or load a course first.");
    return;
  }

  saveCurrentSlide();
  saveCurrentCode();

  const btn = $("saveCourseBtn");
  if (!btn) return;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Saving to vault…";

  try {
    const data = await requestJson("/api/courses/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.course)
    });

    if (data.course && data.course.id) {
      state.course.id = data.course.id;
    }
    toast(data.message || "Course saved to your persistent vault!");

    try {
      const countRes = await requestJson("/api/courses");
      const len = countRes.courses ? countRes.courses.length : 0;
      if ($("menuCourseCount")) $("menuCourseCount").textContent = len;
      if ($("profileModalCourseCount")) $("profileModalCourseCount").textContent = len;
      const teacherRole = document.querySelector(".teacher-role");
      if (teacherRole) teacherRole.innerHTML = `Teacher &bull; ${len} saved`;
    } catch { /* Silent */ }

  } catch (err) {
    if (err.message && (err.message.includes("401") || err.message.toLowerCase().includes("unauthorized") || err.message.toLowerCase().includes("sign in"))) {
      toast("Please sign in as a teacher to save courses to your persistent vault.");
      window.location.href = "/login?next=/";
    } else {
      toast(`Save failed: ${err.message}`);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

async function handleSettingsSubmit(event) {
  event.preventDefault();
  const input = $("settingsFullName");
  const feedback = $("settingsFeedback");
  const submitBtn = $("btnSaveSettings");
  if (!input) return;

  const fullName = input.value.trim();
  if (!fullName) {
    if (feedback) {
      feedback.textContent = "Please enter your full name.";
      feedback.hidden = false;
    }
    return;
  }

  if (feedback) feedback.hidden = true;
  submitBtn.disabled = true;
  submitBtn.textContent = "Saving…";

  try {
    const data = await requestJson("/api/auth/update-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName })
    });

    const updatedUser = data.user;
    if (updatedUser) {
      if ($("teacherName")) $("teacherName").textContent = updatedUser.fullName;
      if ($("dropdownUserName")) $("dropdownUserName").textContent = updatedUser.fullName;
      if ($("profileModalName")) $("profileModalName").textContent = updatedUser.fullName;
      if ($("teacherAvatar")) $("teacherAvatar").textContent = updatedUser.initials;
      if ($("profileModalAvatar")) $("profileModalAvatar").textContent = updatedUser.initials;
    }

    toast("Profile name updated successfully.");
    closeModals();
  } catch (err) {
    if (feedback) {
      feedback.textContent = err.message || "Failed to update profile.";
      feedback.hidden = false;
    }
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Save Changes";
  }
}

function initializeTeacherAuthUI() {
  $("profileDropdownBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleProfileDropdown();
  });

  document.addEventListener("click", (e) => {
    const profileRegion = $("sidebarTeacherProfile");
    if (profileRegion && !profileRegion.contains(e.target)) {
      closeProfileDropdown();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeProfileDropdown();
      closeModals();
    }
  });

  $("menuMyProfile")?.addEventListener("click", () => {
    closeProfileDropdown();
    loadTeacherProfile();
    openModal("modalMyProfile");
  });

  $("menuMyCourses")?.addEventListener("click", () => {
    closeProfileDropdown();
    loadSavedCourses();
    openModal("modalMyCourses");
  });

  $("menuAccountSettings")?.addEventListener("click", () => {
    closeProfileDropdown();
    const currentName = $("teacherName")?.textContent || "";
    if ($("settingsFullName")) $("settingsFullName").value = currentName;
    if ($("settingsFeedback")) $("settingsFeedback").hidden = true;
    openModal("modalAccountSettings");
  });

  $("btnSwitchToSettings")?.addEventListener("click", () => {
    closeModals();
    const currentName = $("teacherName")?.textContent || "";
    if ($("settingsFullName")) $("settingsFullName").value = currentName;
    if ($("settingsFeedback")) $("settingsFeedback").hidden = true;
    openModal("modalAccountSettings");
  });

  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", closeModals);
  });

  $("modalBackdrop")?.addEventListener("click", closeModals);

  $("settingsForm")?.addEventListener("submit", handleSettingsSubmit);

  $("saveCourseBtn")?.addEventListener("click", saveActiveCourse);
}

initializeTeacherAuthUI();

