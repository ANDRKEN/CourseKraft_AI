The plan is to update the performance of the long-running network calls by making them non-blocking for the event loop. Given this is a Flask application that has started supporting async views out-of-the-box (with `asgiref`), we can convert the `generate` and `verify` routes to `async def` and use `asyncio.to_thread` to wrap `urllib.request.urlopen` (which blocks the thread).

1. Change `call_gemini` to `async def call_gemini()`.
2. Change `@app.route("/api/generate")` to `async def generate()`.
3. Change `gemini_provider.generate_content_text` to `async def generate_content_text()`. Update `call_gemini` to `await` it.
4. Update `gemini_provider.py`'s `with urllib.request.urlopen(...)` block to wrap the blocking call using `await asyncio.to_thread(urllib.request.urlopen, request, timeout=...)` and fetch response in a thread. Since the response object `read()` is also blocking I/O, we should run both the request and read in the thread pool.
5. Apply the same logic to `judge0_provider.verify_code` and the `/api/verify` view.
6. Verify and measure the performance baseline before and after using a concurrent load test script, to demonstrate improved throughput without blocking the event loop.
