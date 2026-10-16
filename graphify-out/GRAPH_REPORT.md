# Graph Report - CourseKraft_AI  (2026-10-17)

## Corpus Check
- Corpus is ~12,326 words - fits in a single context window. You may not need a graph.

## Summary
- 172 nodes · 293 edges · 12 communities (7 shown, 5 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.91)
- Token cost: 12,000 input · 3,500 output

## Community Hubs (Navigation)
- Integration and Regression Tests
- Client UI State and Rendering
- AI Provider and Code Execution
- Flask API Routes and Orchestration
- Deck and Document Exporting
- Testing Utilities and Environment
- Course Content Validation
- Interactive 3D Paper Canvas
- Core MVP Architecture
- Environment Configuration
- Responsive Viewport Checks

## God Nodes (most connected - your core abstractions)
1. `FlaskAppTests` - 32 edges
2. `create_pptx()` - 12 edges
3. `call_gemini()` - 10 edges
4. `validate_course()` - 10 edges
5. `generate_content_text()` - 9 edges
6. `verify_code()` - 9 edges
7. `esc()` - 9 edges
8. `renderSlides()` - 8 edges
9. `renderAll()` - 8 edges
10. `setCourse()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `Slide In-Session Persistence Verification` --conceptually_related_to--> `saveCurrentSlide()`  [INFERRED]
  tests/BROWSER_REGRESSION.md → static/app.js
- `Course Brief Creation Panel` --references--> `generateCourse()`  [EXTRACTED]
  templates/index.html → static/app.js
- `Workspace Export Controls` --references--> `downloadExport()`  [EXTRACTED]
  templates/index.html → static/app.js
- `Studio Web UI Template` --references--> `index()`  [EXTRACTED]
  templates/index.html → app.py
- `Fixed Sample Isolation` --rationale_for--> `sample()`  [INFERRED]
  README.md → app.py

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Honest Code Verification Pipeline** — readme_honest_verification, judge0_provider, app_verify, tests_browser_regression_verification_honesty_check, tests_test_app_flaskapptests_test_verification_without_runner_never_claims_pass [INFERRED 0.95]
- **Document Export Generation Pipeline** — readme_export_formats, course_exports_create_pdf, course_exports_create_pptx, requirements_reportlab, requirements_python_pptx [INFERRED 0.95]
- **Sample Course Isolation System** — readme_fixed_sample_isolation, app_sample, static_app_loadsample, tests_browser_regression_sample_isolation_check [INFERRED 0.95]

## Communities (12 total, 5 thin omitted)

### Community 0 - "Integration and Regression Tests"
Cohesion: 0.06
Nodes (7): call_gemini(), AI Provider Notice Verification, Sample Course Isolation Verification, Unconfigured Runner Honesty Verification, FlaskAppTests, gemini_response(), runner_response()

### Community 1 - "Client UI State and Rendering"
Cohesion: 0.14
Nodes (32): downloadExport(), emptyMarkup(), esc(), generateCourse(), initializePaperScene(), loadSample(), refreshStatus(), renderAll() (+24 more)

### Community 2 - "AI Provider and Code Execution"
Cohesion: 0.10
Nodes (16): verify(), _extract_candidate_text(), GeminiProviderError, generate_content_text(), _request_error_message(), _retry_delay(), _configured_language_ids(), _headers_for_runner() (+8 more)

### Community 3 - "Flask API Routes and Orchestration"
Cohesion: 0.10
Nodes (17): build_generation_prompt(), export_pdf(), export_pptx(), generate(), index(), request_too_large(), sample(), status() (+9 more)

### Community 4 - "Deck and Document Exporting"
Cohesion: 0.18
Nodes (8): _chunks(), create_pptx(), base_slide(), rectangle(), textbox(), _short_text(), PDF and PPTX Local Exporters, Python-PPTX Dependency

### Community 6 - "Course Content Validation"
Cohesion: 0.50
Nodes (5): _check_object_list(), _check_text(), _check_text_list(), validate_course(), _validate_item()

### Community 7 - "Interactive 3D Paper Canvas"
Cohesion: 0.40
Nodes (4): createPaperScene(), addMaterial(), addMesh(), Interactive Paper Scene Canvas

## Knowledge Gaps
- **21 isolated node(s):** `Local-First MVP Architecture`, `Bounded Gemini Fallback and Retries`, `Fixed Sample Isolation`, `Judge0 Isolated Runner Integration`, `PDF and PPTX Local Exporters` (+16 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 70 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `FlaskAppTests` connect `Integration and Regression Tests` to `Testing Utilities and Environment`?**
  _High betweenness centrality (0.201) - this node is a cross-community bridge._
- **What connects `Local-First MVP Architecture`, `Bounded Gemini Fallback and Retries`, `Fixed Sample Isolation` to the rest of the system?**
  _21 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Integration and Regression Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.06401137980085349 - nodes in this community are weakly interconnected._
- **Why does `create_pptx()` connect `Deck and Document Exporting` to `Flask API Routes and Orchestration`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **Should `Client UI State and Rendering` be split into smaller, more focused modules?**
  _Cohesion score 0.1408199643493761 - nodes in this community are weakly interconnected._
- **Why does `call_gemini()` connect `Integration and Regression Tests` to `AI Provider and Code Execution`, `Flask API Routes and Orchestration`, `Course Content Validation`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Should `AI Provider and Code Execution` be split into smaller, more focused modules?**
  _Cohesion score 0.10483870967741936 - nodes in this community are weakly interconnected._