/* Thin fetch wrapper: same-origin cookies, CSRF double-submit header, typed errors. No tokens in JS storage. */

export class ApiError extends Error {
  status: number;
  code?: string;
  detail: unknown;
  constructor(status: number, message: string, detail: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
    if (detail && typeof detail === "object" && "code" in detail) this.code = String((detail as { code: unknown }).code);
  }
}

function csrfToken(): string {
  const match = document.cookie.split("; ").find((c) => c.startsWith("pp_csrf="));
  return match ? decodeURIComponent(match.slice("pp_csrf=".length)) : "";
}

type Query = Record<string, string | number | boolean | string[] | undefined | null>;

function buildUrl(path: string, query?: Query): string {
  const params = new URLSearchParams();
  Object.entries(query ?? {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    if (Array.isArray(v)) v.forEach((item) => params.append(k, item));
    else params.set(k, String(v));
  });
  const qs = params.toString();
  return `/api${path}${qs ? `?${qs}` : ""}`;
}

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-CSRF-Token"] = csrfToken();
  const res = await fetch(buildUrl(path, query), {
    method, headers, credentials: "same-origin", body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const payload = res.headers.get("content-type")?.includes("application/json") ? await res.json() : null;
  if (!res.ok) {
    const detail = payload?.detail ?? payload;
    const message = typeof detail === "string" ? detail
      : detail && typeof detail === "object" && "message" in detail ? String(detail.message)
      : Array.isArray(detail) ? "Some fields are not valid." : `Request failed (${res.status}).`;
    if (res.status === 401 && path !== "/auth/login") window.dispatchEvent(new CustomEvent("portal:session-expired"));
    throw new ApiError(res.status, message, detail);
  }
  return payload as T;
}

async function upload<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST", body: form, credentials: "same-origin",
    headers: { Accept: "application/json", "X-CSRF-Token": csrfToken() },
  });
  const payload = res.headers.get("content-type")?.includes("application/json") ? await res.json() : null;
  if (!res.ok) {
    const detail = payload?.detail ?? payload;
    const message = typeof detail === "string" ? detail
      : detail && typeof detail === "object" && "message" in detail ? String(detail.message) : `Upload failed (${res.status}).`;
    throw new ApiError(res.status, message, detail);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>("GET", path, undefined, query),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
  upload,
};
