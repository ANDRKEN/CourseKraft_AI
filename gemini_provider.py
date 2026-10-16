"""Secret-safe, bounded HTTP adapter for Gemini course generation."""

import json
import socket
import time
import urllib.error
import urllib.parse
import urllib.request


API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models"
REQUEST_TIMEOUT_SECONDS = 25
TOTAL_TIMEOUT_SECONDS = 70
MAX_RETRY_DELAY_SECONDS = 2
MAX_RESPONSE_BYTES = 1024 * 1024
RETRYABLE_STATUS_CODES = {408, 429, 500, 502, 503, 504}


class GeminiProviderError(Exception):
    """Provider failure with a safe message suitable for the UI."""

    def __init__(self, message):
        super().__init__(message)
        self.user_message = message


def _request_error_message(status_code):
    if status_code in (401, 403):
        return "Gemini rejected the configured API key. Check that the key is valid and has Gemini API access."
    if status_code == 429:
        return "Gemini rate or quota limit reached. Wait before trying again or check the API quota."
    if status_code >= 500:
        return "Gemini is temporarily unavailable. Try again in a moment."
    return "Gemini could not accept this generation request. Check the configured model and try again."


def _retry_delay(headers, attempt):
    retry_after = headers.get("Retry-After", "") if headers else ""
    try:
        delay = float(retry_after)
    except (TypeError, ValueError):
        delay = 0.5 * (2 ** attempt)
    return min(MAX_RETRY_DELAY_SECONDS, max(0, delay))


def _extract_candidate_text(response_body):
    try:
        response_data = json.loads(response_body.decode("utf-8"))
    except (UnicodeDecodeError, TypeError, ValueError):
        raise GeminiProviderError("Gemini returned a malformed response. Try again.") from None

    if not isinstance(response_data, dict):
        raise GeminiProviderError("Gemini returned a malformed response. Try again.")
    candidates = response_data.get("candidates")
    if not isinstance(candidates, list) or not candidates or not isinstance(candidates[0], dict):
        raise GeminiProviderError("Gemini did not return course content. Revise the topic or try again.")
    content = candidates[0].get("content")
    parts = content.get("parts") if isinstance(content, dict) else None
    if not isinstance(parts, list):
        raise GeminiProviderError("Gemini returned an empty course response. Try again.")
    text = "".join(part.get("text", "") for part in parts if isinstance(part, dict))
    if not text.strip():
        raise GeminiProviderError("Gemini returned an empty course response. Try again.")
    return text.strip()


def generate_content_text(
    api_key,
    model,
    prompt,
    *,
    fallback_models=(),
    timeout=REQUEST_TIMEOUT_SECONDS,
    total_timeout=TOTAL_TIMEOUT_SECONDS,
):
    """Send bounded generation requests with optional model failover.

    The key is sent only in the documented request header. Provider response
    bodies and exception text are intentionally never returned to callers.
    """
    if not api_key:
        raise GeminiProviderError(
            "AI generation is unavailable because GEMINI_API_KEY is not configured."
        )

    models = []
    for candidate in (model, *(fallback_models or ())):
        if isinstance(candidate, str):
            candidate = candidate.strip()
            if candidate and candidate not in models:
                models.append(candidate)
    models = models[:4]
    if not models:
        raise GeminiProviderError("AI generation is unavailable because no Gemini model is configured.")

    try:
        request_timeout = max(1.0, min(float(timeout), REQUEST_TIMEOUT_SECONDS))
        overall_timeout = max(1.0, min(float(total_timeout), TOTAL_TIMEOUT_SECONDS))
    except (TypeError, ValueError):
        raise GeminiProviderError("Gemini generation is temporarily unavailable. Try again shortly.") from None

    deadline = time.monotonic() + overall_timeout
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.4,
            "responseMimeType": "application/json",
            "maxOutputTokens": 8192,
        },
    }
    last_status = None

    for model_index, candidate_model in enumerate(models):
        model_path = urllib.parse.quote(candidate_model, safe="-._")
        url = f"{API_ROOT}/{model_path}:generateContent"
        # One bounded retry per model; 429/503 move directly to the next model.
        for attempt in range(2):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise GeminiProviderError("Gemini generation timed out. Try again in a moment.")
            request = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "x-goog-api-key": api_key,
                },
                method="POST",
            )
            try:
                with urllib.request.urlopen(request, timeout=min(request_timeout, remaining)) as response:
                    response_body = response.read(MAX_RESPONSE_BYTES + 1)
                if len(response_body) > MAX_RESPONSE_BYTES:
                    raise GeminiProviderError("Gemini returned a response that is too large. Try a shorter topic.")
                return _extract_candidate_text(response_body)
            except GeminiProviderError:
                raise
            except urllib.error.HTTPError as error:
                last_status = error.code
                try:
                    error.close()
                except Exception:
                    pass
                if error.code in (429, 503) and model_index < len(models) - 1:
                    break
                if error.code in RETRYABLE_STATUS_CODES and attempt == 0:
                    delay = min(_retry_delay(error.headers, attempt), max(0, deadline - time.monotonic()))
                    if delay > 0:
                        time.sleep(delay)
                        continue
                if error.code in RETRYABLE_STATUS_CODES and model_index < len(models) - 1:
                    break
                raise GeminiProviderError(_request_error_message(error.code)) from None
            except (socket.timeout, TimeoutError, urllib.error.URLError):
                if attempt == 0 and deadline - time.monotonic() > 0.5:
                    time.sleep(min(0.25, max(0, deadline - time.monotonic())))
                    continue
                if model_index < len(models) - 1:
                    break
                raise GeminiProviderError("Could not reach Gemini. Check the server network connection and try again.") from None
            except Exception:
                # HTTP exception text can contain credential-bearing request details.
                raise GeminiProviderError("Gemini generation failed. Try again in a moment.") from None

    if last_status is not None:
        raise GeminiProviderError(_request_error_message(last_status))
    raise GeminiProviderError("Gemini is temporarily unavailable. Try again in a moment.")
