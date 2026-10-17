"""Automated tests for teacher authentication, profile management, and persistent course vault."""

import json
import unittest
from copy import deepcopy

import database
from app import app
from models import User, Course
from security import (
    generate_reset_token,
    verify_reset_token,
    validate_password_strength,
    validate_email_format,
)


SAMPLE_COURSE_PAYLOAD = {
    "title": "Algorithms & Complexity",
    "topic": "Algorithms and Data Structures",
    "level": "Intermediate",
    "durationMinutes": 45,
    "language": "Python",
    "objectives": ["Analyze time complexity with Big-O", "Implement binary search"],
    "slides": [
        {
            "title": "Big-O Notation",
            "bullets": ["Growth rates of functions", "Worst-case analysis", "O(1) vs O(n) vs O(log n)"],
            "speakerNotes": "Show logarithmic curve on the whiteboard.",
            "visualType": "comparison",
            "visualDescription": "Compare linear and logarithmic curves",
            "visualLabels": ["Linear O(n)", "Logarithmic O(log n)"]
        }
    ],
    "codeExamples": [
        {
            "id": "py-bs-01",
            "title": "Binary Search",
            "language": "python",
            "code": "def search(arr, x):\n    return x in arr\nprint(search([1, 2, 3], 2))",
            "testDescription": "Returns True",
            "expectedOutput": "True"
        }
    ],
    "exercises": [
        {
            "title": "Implement recursive binary search",
            "description": "Write binary search using recursion with low and high bounds.",
            "difficulty": "Medium",
            "testHint": "Base case is low > high."
        }
    ],
    "quiz": [
        {
            "question": "What is the time complexity of binary search on a sorted list?",
            "options": ["O(log n)", "O(n)", "O(n^2)", "O(1)"],
            "correctIndex": 0,
            "explanation": "Binary search halves the search interval at each step."
        }
    ],
    "cheatSheet": [
        {"term": "Big-O", "definition": "Upper bound of asymptotic running time."}
    ]
}


class TeacherAuthAndPersistenceTests(unittest.TestCase):
    def setUp(self):
        app.config["TESTING"] = True
        app.config["WTF_CSRF_ENABLED"] = False
        app.config["SECRET_KEY"] = "test-secret-key-coursekraft"

        # Use isolated in-memory SQLite database for test suite
        self.engine = database.init_db(app, db_url="sqlite:///:memory:")
        self.client = app.test_client()

    def tearDown(self):
        database.db_session.remove()
        database.Base.metadata.drop_all(bind=self.engine)

    def _get_csrf_token(self):
        """Helper to obtain CSRF token from session."""
        with self.client.session_transaction() as sess:
            if "_csrf_token" not in sess:
                sess["_csrf_token"] = "test-csrf-token-12345"
            return sess["_csrf_token"]

    def _register_teacher(self, full_name="Ada Lovelace", email="ada@analytical.org", password="ValidPassword123!"):
        csrf = self._get_csrf_token()
        return self.client.post("/register", data={
            "csrf_token": csrf,
            "full_name": full_name,
            "email": email,
            "password": password,
            "confirm_password": password
        }, follow_redirects=False)

    def _login_teacher(self, email="ada@analytical.org", password="ValidPassword123!"):
        csrf = self._get_csrf_token()
        return self.client.post("/login", data={
            "csrf_token": csrf,
            "email": email,
            "password": password
        }, follow_redirects=False)

    # -------------------------------------------------------------
    # 1. Registration
    # -------------------------------------------------------------

    def test_teacher_can_register(self):
        res = self._register_teacher(full_name="Grace Hopper", email="grace@navy.mil", password="StrongPassword123")
        self.assertEqual(res.status_code, 302)
        self.assertEqual(res.headers.get("Location"), "/")

        user = database.db_session.query(User).filter_by(email="grace@navy.mil").first()
        self.assertIsNotNone(user)
        self.assertEqual(user.full_name, "Grace Hopper")
        self.assertEqual(user.initials, "GH")
        self.assertTrue(user.check_password("StrongPassword123"))

        # Registered user should be logged in
        me = self.client.get("/api/auth/me")
        data = me.get_json()
        self.assertTrue(data.get("authenticated"))
        self.assertEqual(data.get("fullName"), "Grace Hopper")

    def test_duplicate_email_registration_rejected(self):
        self._register_teacher(email="dup@school.edu")
        self.client.get("/logout")
        # Second registration with identical email
        res2 = self._register_teacher(full_name="Another Teacher", email="dup@school.edu")
        self.assertEqual(res2.status_code, 400)
        self.assertIn(b"already registered", res2.data)

    def test_registration_validation_enforced(self):
        csrf = self._get_csrf_token()
        # Password too short (<8)
        res = self.client.post("/register", data={
            "csrf_token": csrf, "full_name": "Test", "email": "test@s.edu", "password": "short", "confirm_password": "short"
        })
        self.assertEqual(res.status_code, 400)
        self.assertIn(b"at least 8 characters", res.data)

        # Passwords mismatch
        res2 = self.client.post("/register", data={
            "csrf_token": csrf, "full_name": "Test", "email": "test@s.edu", "password": "Password123", "confirm_password": "DifferentPassword123"
        })
        self.assertEqual(res2.status_code, 400)
        self.assertIn(b"Passwords do not match", res2.data)

        # Malformed email
        res3 = self.client.post("/register", data={
            "csrf_token": csrf, "full_name": "Test", "email": "invalid-email", "password": "Password123", "confirm_password": "Password123"
        })
        self.assertEqual(res3.status_code, 400)
        self.assertIn(b"valid email", res3.data)

    # -------------------------------------------------------------
    # 2. Login & Logout
    # -------------------------------------------------------------

    def test_teacher_can_login_with_valid_credentials(self):
        self._register_teacher(email="prof@mit.edu", password="SecretPass456!")
        self.client.get("/logout")

        # Login
        res = self._login_teacher(email="prof@mit.edu", password="SecretPass456!")
        self.assertEqual(res.status_code, 302)
        self.assertEqual(res.headers.get("Location"), "/")

        # Check authenticated session
        me = self.client.get("/api/auth/me")
        self.assertTrue(me.get_json().get("authenticated"))

    def test_invalid_credentials_rejected(self):
        self._register_teacher(email="valid@univ.edu", password="ValidPassword123!")
        self.client.get("/logout")

        # Wrong password
        res = self._login_teacher(email="valid@univ.edu", password="WrongPassword999")
        self.assertEqual(res.status_code, 401)
        self.assertIn(b"Invalid email address or password", res.data)

        # Unknown email
        res2 = self._login_teacher(email="unknown@univ.edu", password="ValidPassword123!")
        self.assertEqual(res2.status_code, 401)
        self.assertIn(b"Invalid email address or password", res2.data)

    def test_logout_ends_session(self):
        self._register_teacher()
        res = self.client.get("/logout")
        self.assertEqual(res.status_code, 302)
        self.assertEqual(res.headers.get("Location"), "/login")

        me = self.client.get("/api/auth/me")
        self.assertFalse(me.get_json().get("authenticated"))

    # -------------------------------------------------------------
    # 3. Protected Routes & Profile Management
    # -------------------------------------------------------------

    def test_protected_routes_require_authentication(self):
        # Without logging in
        res_courses = self.client.get("/api/courses")
        self.assertEqual(res_courses.status_code, 302)
        self.assertIn("/login", res_courses.headers.get("Location", ""))

        res_save = self.client.post("/api/courses/save", json=SAMPLE_COURSE_PAYLOAD)
        self.assertEqual(res_save.status_code, 302)

        res_update_prof = self.client.post("/api/auth/update-profile", json={"fullName": "Hacker"})
        self.assertEqual(res_update_prof.status_code, 302)

    def test_profile_update_functional(self):
        self._register_teacher(full_name="Katherine Johnson")
        res = self.client.post("/api/auth/update-profile", json={"fullName": "Dr. Katherine G. Johnson"})
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get("success"))
        self.assertEqual(data["user"]["fullName"], "Dr. Katherine G. Johnson")
        self.assertEqual(data["user"]["initials"], "DJ")

        # Verify DB updated
        user = database.db_session.query(User).filter_by(email="ada@analytical.org").first()
        self.assertEqual(user.full_name, "Dr. Katherine G. Johnson")

    # -------------------------------------------------------------
    # 4. Course Persistence & Teacher Isolation
    # -------------------------------------------------------------

    def test_teacher_can_create_and_save_course(self):
        self._register_teacher()
        res = self.client.post("/api/courses/save", json=SAMPLE_COURSE_PAYLOAD)
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get("success"))
        self.assertIn("course", data)
        course_id = data["course"]["id"]
        self.assertTrue(course_id)

        # List saved courses
        list_res = self.client.get("/api/courses")
        self.assertEqual(list_res.status_code, 200)
        courses = list_res.get_json().get("courses")
        self.assertEqual(len(courses), 1)
        self.assertEqual(courses[0]["title"], SAMPLE_COURSE_PAYLOAD["title"])

    def test_saved_course_survives_restart(self):
        self._register_teacher()
        save_res = self.client.post("/api/courses/save", json=SAMPLE_COURSE_PAYLOAD)
        course_id = save_res.get_json()["course"]["id"]

        # Simulate restart by tearing down and re-binding db_session
        database.db_session.remove()

        course = database.db_session.get(Course, course_id)
        self.assertIsNotNone(course)
        self.assertEqual(course.title, SAMPLE_COURSE_PAYLOAD["title"])
        content = course.get_content()
        self.assertEqual(len(content["slides"]), 1)
        self.assertEqual(content["slides"][0]["title"], "Big-O Notation")
        self.assertEqual(len(content["codeExamples"]), 1)
        self.assertEqual(len(content["quiz"]), 1)

    def test_teacher_can_reopen_and_update_own_course(self):
        self._register_teacher()
        save_res = self.client.post("/api/courses/save", json=SAMPLE_COURSE_PAYLOAD)
        course_id = save_res.get_json()["course"]["id"]

        # Retrieve course
        get_res = self.client.get(f"/api/courses/{course_id}")
        self.assertEqual(get_res.status_code, 200)
        self.assertEqual(get_res.get_json()["course"]["title"], SAMPLE_COURSE_PAYLOAD["title"])

        # Update course
        updated_payload = deepcopy(SAMPLE_COURSE_PAYLOAD)
        updated_payload["title"] = "Advanced Algorithms & Optimization"
        put_res = self.client.put(f"/api/courses/{course_id}", json=updated_payload)
        self.assertEqual(put_res.status_code, 200)

        # Confirm update persisted
        updated_get = self.client.get(f"/api/courses/{course_id}")
        self.assertEqual(updated_get.get_json()["course"]["title"], "Advanced Algorithms & Optimization")

    def test_teacher_isolation_forbidden_access(self):
        """Verify Teacher B cannot read, modify, or delete Teacher A's course."""
        # 1. Register Teacher A and save Course A
        self._register_teacher(full_name="Teacher A", email="teacher_a@school.org")
        save_res = self.client.post("/api/courses/save", json=SAMPLE_COURSE_PAYLOAD)
        course_a_id = save_res.get_json()["course"]["id"]
        self.client.get("/logout")

        # 2. Register Teacher B
        self._register_teacher(full_name="Teacher B", email="teacher_b@school.org")

        # Teacher B cannot list Teacher A's courses
        list_res = self.client.get("/api/courses")
        self.assertEqual(len(list_res.get_json().get("courses")), 0)

        # Teacher B cannot fetch Teacher A's course
        get_res = self.client.get(f"/api/courses/{course_a_id}")
        self.assertEqual(get_res.status_code, 403)
        self.assertIn("Forbidden", get_res.get_json().get("error", ""))

        # Teacher B cannot update Teacher A's course
        put_res = self.client.put(f"/api/courses/{course_a_id}", json=SAMPLE_COURSE_PAYLOAD)
        self.assertEqual(put_res.status_code, 403)

        # Teacher B cannot delete Teacher A's course
        del_res = self.client.delete(f"/api/courses/{course_a_id}")
        self.assertEqual(del_res.status_code, 403)

        # Course A remains intact in DB
        course_a = database.db_session.get(Course, course_a_id)
        self.assertIsNotNone(course_a)

    def test_teacher_can_delete_own_course(self):
        self._register_teacher()
        save_res = self.client.post("/api/courses/save", json=SAMPLE_COURSE_PAYLOAD)
        course_id = save_res.get_json()["course"]["id"]

        del_res = self.client.delete(f"/api/courses/{course_id}")
        self.assertEqual(del_res.status_code, 200)
        self.assertTrue(del_res.get_json().get("success"))

        # Verify gone
        get_res = self.client.get(f"/api/courses/{course_id}")
        self.assertEqual(get_res.status_code, 404)

    # -------------------------------------------------------------
    # 5. Password Recovery Tokens
    # -------------------------------------------------------------

    def test_password_recovery_token_cycle(self):
        email = "recover@teacher.org"
        token = generate_reset_token(email)
        self.assertTrue(token)

        # Valid verification
        verified_email = verify_reset_token(token)
        self.assertEqual(verified_email, email)

        # Tampered token
        tampered_email = verify_reset_token(token + "corrupt")
        self.assertIsNone(tampered_email)

    def test_reset_password_flow(self):
        self._register_teacher(email="reset_me@school.org", password="OldPassword123")
        self.client.get("/logout")

        token = generate_reset_token("reset_me@school.org")
        csrf = self._get_csrf_token()

        # Submit new password
        res = self.client.post(f"/reset-password/{token}", data={
            "csrf_token": csrf,
            "password": "NewSecretPassword456!",
            "confirm_password": "NewSecretPassword456!"
        }, follow_redirects=False)

        self.assertEqual(res.status_code, 302)
        self.assertIn("/login", res.headers.get("Location", ""))

        # Verify old password fails and new password succeeds
        res_fail = self._login_teacher(email="reset_me@school.org", password="OldPassword123")
        self.assertEqual(res_fail.status_code, 401)

        res_ok = self._login_teacher(email="reset_me@school.org", password="NewSecretPassword456!")
        self.assertEqual(res_ok.status_code, 302)

    # -------------------------------------------------------------
    # 6. Existing Export Preservation
    # -------------------------------------------------------------

    def test_existing_exports_function_for_saved_course(self):
        self._register_teacher()
        save_res = self.client.post("/api/courses/save", json=SAMPLE_COURSE_PAYLOAD)
        course_id = save_res.get_json()["course"]["id"]
        course_data = self.client.get(f"/api/courses/{course_id}").get_json()["course"]

        # PPTX Export
        pptx_res = self.client.post("/api/export/pptx", json=course_data)
        self.assertEqual(pptx_res.status_code, 200)
        self.assertEqual(pptx_res.mimetype, "application/vnd.openxmlformats-officedocument.presentationml.presentation")
        self.assertGreater(len(pptx_res.data), 1000)

        # PDF Export
        pdf_res = self.client.post("/api/export/pdf", json=course_data)
        self.assertEqual(pdf_res.status_code, 200)
        self.assertEqual(pdf_res.mimetype, "application/pdf")
        self.assertTrue(pdf_res.data.startswith(b"%PDF"))    # -------------------------------------------------------------
    # 7. OnlineCompiler Provider Verification
    # -------------------------------------------------------------

    def test_onlinecompiler_provider_success_and_matching(self):
        import onlinecompiler_provider
        from unittest import mock
        mock_response = mock.MagicMock()
        mock_response.__enter__.return_value.read.return_value = json.dumps({
            "output": "Asha\n", "error": "", "status": "success", "exit_code": 0
        }).encode("utf-8")

        with mock.patch("urllib.request.urlopen", return_value=mock_response):
            import asyncio
            result = asyncio.run(onlinecompiler_provider.verify_code(
                "java", "public class Main {}", expected_output="Asha", api_key="test-key"
            ))
            self.assertEqual(result["status"], "PASSED")
            self.assertEqual(result["stdout"], "Asha\n")

    def test_onlinecompiler_provider_mismatch(self):
        import onlinecompiler_provider
        from unittest import mock
        mock_response = mock.MagicMock()
        mock_response.__enter__.return_value.read.return_value = json.dumps({
            "output": "Wrong output\n", "error": "", "status": "success", "exit_code": 0
        }).encode("utf-8")

        with mock.patch("urllib.request.urlopen", return_value=mock_response):
            import asyncio
            result = asyncio.run(onlinecompiler_provider.verify_code(
                "python", "print('Wrong output')", expected_output="Expected output", api_key="test-key"
            ))
            self.assertEqual(result["status"], "FAILED")
            self.assertIn("output did not match", result["message"])

    def test_onlinecompiler_unsupported_language(self):
        import onlinecompiler_provider
        import asyncio
        result = asyncio.run(onlinecompiler_provider.verify_code(
            "fortran90", "program main", api_key="test-key"
        ))
        self.assertEqual(result["status"], "NOT VERIFIED")


if __name__ == "__main__":
    unittest.main()

