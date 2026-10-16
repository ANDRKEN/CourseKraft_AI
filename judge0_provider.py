import asyncio
"""Small, isolated HTTP client for a configured Judge0-compatible runner."""

import ipaddress
import json
import re
import socket
import urllib.error
import urllib.parse
import urllib.request


REQUEST_TIMEOUT_SECONDS = 35
MAX_RESPONSE_BYTES = 512 * 1024
DEFAULT_LANGUAGE_IDS = {
    "python": 71,
    "java": 62,
    "javascript": 63,
    "cpp": 54,
}
LANGUAGE_ALIASES = {"python3": "python", "js": "javascript", "c++": "cpp"}
FAILED_RUNNER_STATES = {
    "Wrong Answer",
    "Compilation Error",
    "Runtime Error",
    "Runtime Error (SIGSEGV)",
    "Runtime Error (NZEC)",
    "Time Limit Exceeded",
    "Memory Limit Exceeded",
}
_HEADER_NAME = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]+$")


def _is_loopback(host):
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _runner_url(base_url):
    parsed = urllib.parse.urlsplit(base_url)
    if not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise ValueError("Invalid runner URL configuration.")
    if parsed.scheme != "https" and not (parsed.scheme == "http" and _is_loopback(parsed.hostname)):
        raise ValueError("Runner URL must use HTTPS, except for a local loopback runner.")
    return parsed


def _configured_language_ids(value):
    if not value:
        return DEFAULT_LANGUAGE_IDS
    try:
        parsed = json.loads(value) if isinstance(value, str) else value
    except (TypeError, ValueError):
        return {}
    if not isinstance(parsed, dict):
        return {}
    return {
        name.strip().lower(): language_id
        for name, language_id in parsed.items()
        if isinstance(name, str) and name.strip()
        and isinstance(language_id, int) and not isinstance(language_id, bool)
        and language_id > 0
    }


def _headers_for_runner(parsed_url, api_key, api_key_header):
    headers = {"Content-Type": "application/json"}
    host = parsed_url.hostname.lower()
    if not api_key:
        return headers
    if host == "rapidapi.com" or host.endswith(".rapidapi.com"):
        headers["X-RapidAPI-Key"] = api_key
        headers["X-RapidAPI-Host"] = host
    elif api_key_header:
        if not _HEADER_NAME.fullmatch(api_key_header):
            raise ValueError("Runner API-key header name is invalid.")
        headers[api_key_header] = api_key
    # Other providers receive no guessed authentication header. Set
    # JUDGE0_API_KEY_HEADER to the header their runner explicitly requires.
    return headers


def _safe_text(value, maximum=12000):
    return value[:maximum] if isinstance(value, str) else ""


def _not_verified(message, *, details="", runner_description="Configured Judge0-compatible runner."):
    result = {
        "status": "NOT VERIFIED",
        "message": message,
        "runnerDescription": runner_description,
    }
    if details:
        result["details"] = details
    return result


async def verify_code(base_url, language, code, expected_output="", *, api_key="",
                api_key_header="", language_ids=None):
    """Submit code only to the configured external isolated runner.

    The Flask process never evaluates submitted source. Responses contain safe
    diagnostics only; transport exception details and provider bodies are not
    returned because they can disclose request configuration.
    """
    language_name = LANGUAGE_ALIASES.get(language.lower(), language.lower())
    configured_ids = _configured_language_ids(language_ids)
    language_id = configured_ids.get(language_name)
    if not language_id:
        return _not_verified(
            f"The configured runner does not have a language ID configured for {language_name}.",
            runner_description="Configured runner does not advertise this language.",
        )

    try:
        parsed_url = _runner_url(base_url)
        headers = _headers_for_runner(parsed_url, api_key, api_key_header)
    except ValueError as error:
        # Only local configuration validation messages are used here.
        return _not_verified(
            "The configured runner URL or authentication settings are invalid.",
            details=str(error),
            runner_description="Runner configuration is invalid.",
        )

    runner_host = parsed_url.hostname
    runner_description = f"Judge0-compatible runner at {runner_host}"
    endpoint = urllib.parse.urlunsplit((
        parsed_url.scheme,
        parsed_url.netloc,
        parsed_url.path.rstrip("/") + "/submissions",
        "base64_encoded=false&wait=true",
        "",
    ))
    payload = {"source_code": code, "language_id": language_id, "stdin": ""}
    request = urllib.request.Request(
        endpoint,
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
            return _not_verified("Runner returned a response that is too large to inspect.", runner_description=runner_description)
        result = json.loads(response_body.decode("utf-8"))
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            message = "Runner authentication failed. Check its configured authentication header."
        elif error.code == 404:
            message = "Runner rejected this endpoint or language configuration."
        else:
            message = "Execution service could not verify the code. Check runner availability and try again."
        return _not_verified(message, runner_description=runner_description)
    except (socket.timeout, TimeoutError, urllib.error.URLError):
        return _not_verified("Execution service timed out or could not be reached.", runner_description=runner_description)
    except (UnicodeDecodeError, TypeError, ValueError):
        return _not_verified("Execution service returned an unreadable response.", runner_description=runner_description)
    except Exception:
        return _not_verified("Execution service could not verify the code.", runner_description=runner_description)

    if not isinstance(result, dict):
        return _not_verified("Execution service returned an inconclusive response.", runner_description=runner_description)
    status_data = result.get("status")
    status_description = _safe_text(status_data.get("description"), 100) if isinstance(status_data, dict) else ""
    stdout = _safe_text(result.get("stdout"))
    stderr = _safe_text(result.get("stderr") or result.get("compile_output"))

    if status_description == "Accepted":
        output_matches = not expected_output or stdout.rstrip("\r\n") == expected_output.rstrip("\r\n")
        if output_matches:
            message = "Execution completed successfully" + (" and output matched." if expected_output else ".")
            state = "PASSED"
        else:
            message = "Code executed, but output did not match the expected output."
            state = "FAILED"
    elif status_description in FAILED_RUNNER_STATES:
        state = "FAILED"
        message = status_description
    else:
        state = "NOT VERIFIED"
        message = "Runner returned an inconclusive result: " + (status_description or "unknown status")

    return {
        "status": state,
        "message": message,
        "runnerDescription": runner_description,
        "runnerStatus": status_description,
        "stdout": stdout,
        "stderr": stderr,
        "expectedOutput": expected_output,
        "executionTime": result.get("time"),
        "memory": result.get("memory"),
    }
