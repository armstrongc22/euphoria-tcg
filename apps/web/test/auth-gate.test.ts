/**
 * The session-check state helper that fixes the "Verifying access…" hang: it
 * always resolves to loggedIn / loggedOut / error, and can never wait forever
 * (a never-resolving getSession is bounded by the timeout).
 */
import { describe, expect, it } from "vitest";
import { checkSession } from "../src/auth-gate";

describe("checkSession", () => {
  it("reports loggedOut when getSession resolves to null", async () => {
    const result = await checkSession(async () => null, 1000);
    expect(result.state).toBe("loggedOut");
  });

  it("reports loggedIn with the session when getSession resolves", async () => {
    const session = { userId: "u1", email: "player@example.com" };
    const result = await checkSession(async () => session, 1000);
    expect(result.state).toBe("loggedIn");
    if (result.state === "loggedIn") expect(result.session).toEqual(session);
  });

  it("reports error (not a hang) when getSession rejects", async () => {
    const result = await checkSession(async () => {
      throw new Error("network down");
    }, 1000);
    expect(result.state).toBe("error");
  });

  it("times out to error instead of hanging forever", async () => {
    // A getSession that never resolves must still settle, via the timeout.
    const result = await checkSession(() => new Promise<null>(() => {}), 20);
    expect(result.state).toBe("error");
  });
});
