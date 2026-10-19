const STORAGE_KEY = "precedent_sid";
const PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/** A fresh device id: a UUID where the browser has one, else a time plus random suffix. */
function randomId(): string {
  let id: string;
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    id = crypto.randomUUID();
  } else {
    id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  id = id.replace(/[^A-Za-z0-9-]/g, "").slice(0, 64);
  if (!PATTERN.test(id)) id = `device-${Date.now().toString(36)}`;
  return id;
}

function storedId(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value && PATTERN.test(value)) return value;
    return null;
  } catch {
    return null;
  }
}

const sessionId = storedId() ?? randomId();

try {
  localStorage.setItem(STORAGE_KEY, sessionId);
} catch {
  // Private mode or a full quota: the id still works for this page view.
}

const originalFetch = window.fetch.bind(window);

/** The URL of a fetch input, resolved against this page's origin. */
function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === "string") return new URL(input, window.location.origin);
  if (input instanceof URL) return input;
  return new URL(input.url, window.location.origin);
}

window.fetch = function sessionFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = requestUrl(input);
  if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) {
    return originalFetch(input, init);
  }
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set("X-Session-Id", sessionId);
  return originalFetch(input, { ...init, headers });
};
