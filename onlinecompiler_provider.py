import asyncio
"""Isolated HTTP client for OnlineCompiler.io code execution runner."""

import json
import urllib.error
import urllib.request

REQUEST_TIMEOUT_SECONDS = 30
MAX_RESPONSE_BYTES = 512 * 1024

LANGUAGE_MAP = {
    "python": "python-3.14",
    "python3": "python-3.14",
    "py": "python-3.14",
    "java": "openjdk-25",
    "javascript": "typescript-deno",
    "js": "typescript-deno",
    "typescript": "typescript-deno",
    "ts": "typescript-deno",
    "cpp": "g++-15",
    "c++": "g++-15",
    "c": "g++-15",
}

RUNNER_URL = "https://api.onlinecompiler.io/api/run-code-sync/"


def _safe_text(value, maximum=12000):
    return value[:maximum] if isinstance(value, str) else ""


def _not_verified(message, *, details="", runner_description="OnlineCompiler.io runner"):
    result = {
        "status": "NOT VERIFIED",
        "message": message,
        "runnerDescription": runner_description,
    }
    if details:
        result["details"] = details
    return result


async def verify_code(language, code, expected_output="", *, api_key=""):
    """Submit code to OnlineCompiler.io isolated runner.

    The Flask process never evaluates submitted source. Responses contain safe
    diagnostics only; transport exception details and provider bodies are not
    returned because they can disclose request configuration.
    """
    lang_key = (language or "").strip().lower()
    compiler_id = LANGUAGE_MAP.get(lang_key)
    if not compiler_id:
        return _not_verified(
            f"OnlineCompiler does not have a compiler configured for {language}.",
            runner_description="OnlineCompiler runner does not advertise this language.",
        )

    headers = {
        "Content-Type": "application/json",
        "Authorization": api_key,
    }
    payload = {
        "compiler": compiler_id,
        "code": code,
        "input": "",
    }
    runner_description = f"OnlineCompiler.io runner ({compiler_id})"

    request = urllib.request.Request(
        RUNNER_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )

    try:
        def _do_request():
            with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                return response.read(MAX_RESPONSE_BYTES + 1)

        response_body = await asyncio.to_thread(_do_request)
        if len(response_body) > MAX_RESPONSE_BYTES:
            return _not_verified(
                "Runner returned a response that is too large to inspect.",
                runner_description=runner_description,
            )
        result = json.loads(response_body.decode("utf-8"))
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            message = "Runner authentication failed. Check configured OnlineCompiler API key."
        elif error.code == 404:
            message = "Runner endpoint not found."
        else:
            message = "Execution service could not verify the code. Check runner availability and try again."
        return _not_verified(message, runner_description=runner_description)
    except (TimeoutError, urllib.error.URLError):
        return _not_verified(
            "Execution service timed out or could not be reached.",
            runner_description=runner_description,
        )
    except Exception:
        return _not_verified(
            "Execution service could not verify the code.",
            runner_description=runner_description,
        )

    if not isinstance(result, dict):
        return _not_verified(
            "Execution service returned an inconclusive response.",
            runner_description=runner_description,
        )

    stdout = _safe_text(result.get("output"))
    stderr = _safe_text(result.get("error"))
    exit_code = result.get("exit_code")
    status_str = str(result.get("status") or "")

    if exit_code == 0:
        actual_clean = stdout.rstrip("\r\n")
        expected_clean = expected_output.rstrip("\r\n")
        output_matches = not expected_output or actual_clean == expected_clean
        if output_matches:
            message = (
                "Execution completed successfully"
                + (" and output matched." if expected_output else ".")
            )
            state = "PASSED"
        else:
            message = "Code executed, but output did not match the expected output."
            state = "FAILED"
    else:
        state = "FAILED"
        message = stderr or f"Process exited with code {exit_code}"

    runner_status = "Accepted" if exit_code == 0 else (status_str or f"Exit {exit_code}")

    return {
        "status": state,
        "message": message,
        "runnerDescription": runner_description,
        "runnerStatus": runner_status,
        "stdout": stdout,
        "stderr": stderr,
        "expectedOutput": expected_output,
        "executionTime": result.get("time"),
        "memory": result.get("memory"),
    }
