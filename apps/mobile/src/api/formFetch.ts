/*
 * Multipart uploads on React Native. Since Expo's WinterCG fetch became the global `fetch`, a FormData part of the
 * form { uri, name, type } is rejected ("Unsupported FormDataPart implementation"). React Native's own
 * XMLHttpRequest still streams such file parts straight from the file URI, so uploads go through it and come
 * back as an ordinary `Response`.
 */

const isForm = (body: unknown): body is FormData =>
  typeof FormData !== "undefined" && body instanceof FormData;

/** Upper bound for one upload (large PDFs on a slow network); a stalled request fails instead of hanging. */
export const UPLOAD_TIMEOUT_MS = 120_000;

/** `fetch` that sends FormData bodies through XMLHttpRequest; everything else goes to the global fetch. */
export function fetchWithForm(input: string, init: RequestInit = {}): Promise<Response> {
  if (!isForm(init.body)) return fetch(input, init);
  const body = init.body;
  return new Promise<Response>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(init.method ?? "POST", input);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    const headers = (init.headers ?? {}) as Record<string, string>;
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.onload = () => resolve(new Response(xhr.responseText, { status: xhr.status }));
    xhr.onerror = () => reject(new TypeError("Network request failed"));
    xhr.ontimeout = () => reject(new TypeError("Network request timed out"));
    const signal = init.signal;
    if (signal) {
      const abort = () => {
        xhr.abort();
        const err = new Error("Aborted");
        err.name = "AbortError";
        reject(err);
      };
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
    }
    xhr.send(body);
  });
}
