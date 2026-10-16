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
  node.textContent = message;
  node.classList.add("show");
  window.setTimeout(() => node.classList.remove("show"), 3200);
}

function setNotice(message = "", kind = "status") {
  const node = $("providerNotice");
  node.textContent = message;
  node.hidden = !message;
  node.setAttribute("role", kind === "error" ? "alert" : "status");
  node.setAttribute("aria-live", kind === "error" ? "assertive" : "polite");
  node.classList.toggle("alert-warning", kind === "error" || kind === "warning");
}

async function requestJson(url, options = {}) {
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
  $("exerciseList").innerHTML = exercises.length ? exercises.map((item) => `<article class="exercise"><span class="difficulty">${esc(item.difficulty || "Practice")}</span><h4>${esc(item.title || "Untitled exercise")}</h4><p>${esc(item.description || "No description supplied.")}</p>${item.testHint ? `<p><b>Acceptance hint:</b> ${esc(item.testHint)}</p>` : ""}</article>`).join("") : emptyMarkup("No exercises were returned for this course.");
  $("quizCount").textContent = `${quiz.length} ${quiz.length === 1 ? "question" : "questions"}`;
  $("quizList").innerHTML = quiz.length ? quiz.map((item, index) => {
    const options = Array.isArray(item.options) ? item.options : [];
    const answer = Number.isInteger(item.correctIndex) ? options[item.correctIndex] : "Not supplied";
    return `<article class="quiz-item"><span class="q-num">QUESTION ${String(index + 1).padStart(2, "0")}</span><h4>${esc(item.question || "Question")}</h4><ol type="A">${options.map((option) => `<li>${esc(option)}</li>`).join("")}</ol><div class="answer-key"><b>Answer:</b> ${esc(answer || "Not supplied")}<br>${esc(item.explanation || "")}</div></article>`;
  }).join("") : emptyMarkup("No quiz questions were returned for this course.");
}

function renderCheat() {
  const items = Array.isArray(state.course.cheatSheet) ? state.course.cheatSheet : [];
  $("cheatNavCount").textContent = items.length;
  $("cheatTitle").textContent = state.course.title || "Cheat sheet";
  $("cheatGrid").innerHTML = items.length ? items.map((item) => `<article class="term"><b>${esc(item.term || "Term")}</b><p>${esc(item.definition || "No definition supplied.")}</p></article>`).join("") : emptyMarkup("No reference terms were returned for this course.");
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
  try {
    const data = await requestJson("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic, level: $("level").value, durationMinutes: Number($("duration").value), language: $("language").value }) });
    setCourse(data.course, data.message || "Generated with Gemini AI. Review this draft before using it.");
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
  try {
    const data = await requestJson("/api/sample");
    setCourse(data.course, `${data.message} This fixed sample is not adapted to your topic.`);
  } catch (error) { setNotice(error.message, "error"); }
  finally { button.disabled = false; }
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
    const result = await requestJson("/api/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ language: example.language || state.course.language, code: example.code, expectedOutput: example.expectedOutput || "" }) });
    const details = [result.runnerDescription, result.details, result.runnerStatus ? `Runner status: ${result.runnerStatus}` : "", result.stdout !== undefined ? `Actual output: ${result.stdout}` : "", result.stderr ? `Error output: ${result.stderr}` : "", result.expectedOutput ? `Expected output: ${result.expectedOutput}` : ""].filter(Boolean).join("\n");
    setVerification(result.status, result.message || "Runner response received.", details);
  } catch (error) { setVerification("NOT VERIFIED", "Verification request failed", `${error.message} The code was not confirmed as passing.`); }
  finally { button.disabled = false; button.textContent = "▶ Verify with runner"; }
}

async function downloadExport(kind, button) {
  if (!state.course) return;
  saveCurrentSlide();
  saveCurrentCode();
  const original = button.textContent;
  button.disabled = true;
  button.textContent = `Preparing ${kind.toUpperCase()}…`;
  try {
    const response = await fetch(kind === "pdf" ? "/api/export/pdf" : "/api/export/pptx", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state.course) });
    if (!response.ok) {
      let message = `Export failed (${response.status}).`;
      try { const data = await response.json(); message = data.error || message; } catch { /* Keep the status message. */ }
      throw new Error(message);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = kind === "pdf" ? "coursekraft_course.pdf" : "coursekraft_course.pptx";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    toast(`${kind.toUpperCase()} export downloaded`);
  } catch (error) { setAlert("workspaceAlert", error.message); toast(error.message); }
  finally { button.disabled = false; button.textContent = original; }
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
  } catch {
    // Keep the designed CSS paper composition when WebGL or the pinned module is unavailable.
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

document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
$("generateForm").addEventListener("submit", generateCourse);
$("loadSampleBtn").addEventListener("click", loadSample);
$("saveSlide").addEventListener("click", () => { saveCurrentSlide(); renderSlides(); renderOverview(); renderOutline(); toast("Slide changes saved for this session."); });
$("codeSelect").addEventListener("change", () => { saveCurrentCode(); state.selectedCode = Number($("codeSelect").value); renderCodes(); });
$("verifyBtn").addEventListener("click", verifyCode);
$("exportPptx").addEventListener("click", (event) => downloadExport("pptx", event.currentTarget));
$("exportPdfTop").addEventListener("click", (event) => downloadExport("pdf", event.currentTarget));

refreshStatus();
initializePaperScene();
