/**
 * Human-readable text for an unknown thrown value.
 *
 * Critically, Supabase / PostgREST throw a plain error OBJECT — `{ message,
 * details, hint, code }` — NOT a JavaScript `Error`. So `String(err)` on them
 * yields a useless "[object Object]" and `err instanceof Error` is false,
 * hiding the actual Postgres cause (an RLS violation, a constraint, a missing
 * column…). This extracts the message/details/hint/code so the real reason
 * surfaces in the UI and diagnostics instead of being swallowed.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error !== null && typeof error === "object") {
    const e = error as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof e["message"] === "string" && e["message"].length > 0) {
      parts.push(e["message"]);
    }
    if (typeof e["details"] === "string" && e["details"].length > 0) {
      parts.push(e["details"]);
    }
    if (typeof e["hint"] === "string" && e["hint"].length > 0) {
      parts.push(`hint: ${e["hint"]}`);
    }
    const code =
      typeof e["code"] === "string" && e["code"].length > 0 ? ` [${e["code"]}]` : "";
    if (parts.length > 0) return parts.join(" — ") + code;
    try {
      const json = JSON.stringify(error);
      if (json !== undefined && json !== "{}") return json;
    } catch {
      /* circular or non-serialisable — fall through */
    }
  }
  return String(error);
}
