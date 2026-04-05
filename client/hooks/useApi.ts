/**
 * Standardized API fetch wrapper — inspired by Claude Code's error classification pattern.
 *
 * Centralizes:
 * - Consistent error handling (no more scattered try/catch with silent ignore)
 * - JSON parsing
 * - Error logging to server diagnostics endpoint
 * - Type-safe responses
 */

const API_BASE = "/api";

export interface ApiError {
  status: number;
  message: string;
  endpoint: string;
}

/**
 * Type-safe fetch wrapper for API calls.
 * Returns [data, null] on success, [null, error] on failure.
 */
export async function api<T>(
  endpoint: string,
  options?: RequestInit
): Promise<[T | null, null] | [null, ApiError]> {
  const url = endpoint.startsWith("/") ? `${API_BASE}${endpoint}` : `${API_BASE}/${endpoint}`;

  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let message = `HTTP ${res.status}`;
      try {
        const json = JSON.parse(body);
        message = json.error || json.message || message;
      } catch {
        if (body) message = body;
      }
      return [null, { status: res.status, message, endpoint }];
    }

    // Handle 204 No Content
    if (res.status === 204) return [null, null];

    const data = (await res.json()) as T;
    return [data, null];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return [null, { status: 0, message, endpoint }];
  }
}

/** Convenience helpers */
export const apiGet = <T>(endpoint: string) => api<T>(endpoint);

export const apiPost = <T>(endpoint: string, body: unknown) =>
  api<T>(endpoint, { method: "POST", body: JSON.stringify(body) });

export const apiPut = <T>(endpoint: string, body: unknown) =>
  api<T>(endpoint, { method: "PUT", body: JSON.stringify(body) });

export const apiPatch = <T>(endpoint: string, body: unknown) =>
  api<T>(endpoint, { method: "PATCH", body: JSON.stringify(body) });

export const apiDelete = <T>(endpoint: string) => api<T>(endpoint, { method: "DELETE" });
