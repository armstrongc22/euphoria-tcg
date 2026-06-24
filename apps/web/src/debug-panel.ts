/**
 * In-app mobile debug/stability panel (Feature A/C/D). Visible ONLY when
 * `localStorage.euphoriaDebug === "1"`, so it never affects normal users. It
 * surfaces — without devtools — the build stamp, live match metrics, resume
 * snapshot state, lifecycle/error breadcrumbs, and the stability toggles, plus a
 * "Copy Debug Dump" button. Pure DOM; reads diagnostics + flags modules.
 */
import {
  debugEnabled,
  getBuildStamp,
  getLastSnapshotSaveAt,
  getLiveMetrics,
  lastErrorText,
  lastLifecycleEvent,
  readDebugLog,
} from "@euphoria/core/debug-log";
import {
  FLAG_DEBUG,
  STABILITY_FLAGS,
  flag,
  isLikelyMobile,
  setFlag,
} from "./debug-flags";
import { snapshotInfo, type SnapshotInfo } from "@euphoria/core/match-recovery";
import type { KeyValueStore } from "@euphoria/core/signup";

/** Hooks the panel needs from the app to inspect/drive the active match. */
export interface DebugPanelHooks {
  /** The signed-in user id (scopes the snapshot lookup); null when signed out. */
  readonly userId: () => string | null;
  /** The current top-level view name, for display. */
  readonly currentView: () => string;
  /** Recovery store (localStorage), or null when unavailable. */
  readonly store: KeyValueStore | null;
  /** Force-save the current match snapshot now (Feature D.3); no-op when idle. */
  readonly forceSave?: () => boolean;
  /** Validate whether a reload would offer Resume (Feature D.4). */
  readonly simulateReloadCheck?: () => string;
  /**
   * A snapshot of the reward/owned pipeline (auth mode, wins, owned count,
   * pending-claim count + errors), refreshed by the account view. Lets a dump
   * answer "why aren't rewards showing" without devtools.
   */
  readonly reward?: () => Record<string, unknown>;
  /** Opens the feedback / bug-report modal (debug-panel entry point, Feature A). */
  readonly onFeedback?: () => void;
}

/** Builds the full debug dump object (also what "Copy" serializes). */
export function buildDebugDump(hooks: DebugPanelHooks): Record<string, unknown> {
  const userId = hooks.userId();
  const snap: SnapshotInfo | null =
    hooks.store !== null && userId !== null
      ? snapshotInfo(hooks.store, userId)
      : null;
  return {
    build: getBuildStamp(),
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "n/a",
    mobile: isLikelyMobile(),
    view: hooks.currentView(),
    flags: Object.fromEntries(STABILITY_FLAGS.map((f) => [f, flag(f)])),
    metrics: getLiveMetrics(),
    reward: hooks.reward?.() ?? null,
    snapshot: snap,
    lastSnapshotSaveAt: getLastSnapshotSaveAt(),
    lastLifecycle: lastLifecycleEvent(),
    lastError: lastErrorText(),
    recentEvents: readDebugLog().slice(-12),
  };
}

function row(label: string, value: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "debug-panel__row";
  el.innerHTML =
    `<span class="debug-panel__key"></span><span class="debug-panel__val"></span>`;
  el.querySelector(".debug-panel__key")!.textContent = label;
  el.querySelector(".debug-panel__val")!.textContent = value;
  return el;
}

function toggleButton(name: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "debug-panel__toggle";
  b.dataset.flag = name;
  const sync = (): void => {
    const on = flag(name);
    b.textContent = `${name.replace("euphoria", "")}: ${on ? "ON" : "off"}`;
    b.classList.toggle("debug-panel__toggle--on", on);
  };
  b.addEventListener("click", () => {
    setFlag(name, !flag(name));
    sync();
  });
  sync();
  return b;
}

/**
 * Creates the debug panel element + a `refresh()` that re-reads live metrics.
 * Returns null when debug is disabled (so callers can skip mounting entirely).
 */
export function createDebugPanel(
  hooks: DebugPanelHooks,
): { element: HTMLElement; refresh: () => void } | null {
  if (!debugEnabled()) return null;

  const panel = document.createElement("section");
  panel.className = "debug-panel";
  panel.setAttribute("aria-label", "Euphoria debug panel");

  const header = document.createElement("div");
  header.className = "debug-panel__header";
  header.innerHTML = `<strong>Euphoria debug</strong>`;
  const collapse = document.createElement("button");
  collapse.type = "button";
  collapse.className = "debug-panel__collapse";
  collapse.textContent = "▾";
  collapse.addEventListener("click", () =>
    panel.classList.toggle("debug-panel--collapsed"),
  );
  header.append(collapse);
  panel.append(header);

  const body = document.createElement("div");
  body.className = "debug-panel__body";
  panel.append(body);

  const refresh = (): void => {
    const dump = buildDebugDump(hooks);
    body.replaceChildren();

    body.append(row("build", String(dump["build"])));
    body.append(row("view", String(dump["view"])));

    // Reward/owned pipeline — answers "why aren't rewards showing".
    const reward = dump["reward"] as Record<string, unknown> | null;
    if (reward !== null) {
      for (const key of ["mode", "wins", "nextReward", "owned", "pending"]) {
        if (reward[key] !== undefined) body.append(row(key, String(reward[key])));
      }
      const errs = reward["pendingErrors"];
      if (Array.isArray(errs) && errs.length > 0) {
        body.append(row("pendingErr", String(errs[0])));
      }
    }

    const m = dump["metrics"] as Record<string, number>;
    for (const key of [
      "turn",
      "events",
      "logRows",
      "playbackQueue",
      "pendingTimers",
      "floaters",
      "beams",
      "domNodes",
      "imageNodes",
      "artNodes",
    ]) {
      if (m[key] !== undefined) body.append(row(key, String(m[key])));
    }

    const snap = dump["snapshot"] as SnapshotInfo | null;
    if (snap !== null) {
      body.append(
        row(
          "snapshot",
          snap.exists
            ? `turn ${snap.turn ?? "?"} · ${snap.bytes}B · ${snap.ageSeconds ?? "?"}s old`
            : "none",
        ),
      );
      if (snap.problem !== null) body.append(row("snapshot problem", snap.problem));
    }
    body.append(row("last save", String(dump["lastSnapshotSaveAt"] ?? "—")));
    body.append(row("last lifecycle", String(dump["lastLifecycle"] ?? "—")));
    body.append(row("last error", String(dump["lastError"] ?? "—")));

    // Stability toggles.
    const toggles = document.createElement("div");
    toggles.className = "debug-panel__toggles";
    for (const f of STABILITY_FLAGS) toggles.append(toggleButton(f));
    body.append(toggles);

    // Action buttons.
    const actions = document.createElement("div");
    actions.className = "debug-panel__actions";

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "debug-panel__btn";
    copy.textContent = "Copy Debug Dump";
    copy.addEventListener("click", () => {
      const text = JSON.stringify(buildDebugDump(hooks), null, 2);
      const done = (ok: boolean): void => {
        copy.textContent = ok ? "Copied ✓" : "Copy failed — see console";
        if (!ok) console.log("[euphoria debug dump]\n" + text);
        setTimeout(() => (copy.textContent = "Copy Debug Dump"), 1500);
      };
      try {
        const clip = navigator.clipboard;
        if (clip?.writeText) {
          clip.writeText(text).then(() => done(true), () => done(false));
        } else {
          done(false);
        }
      } catch {
        done(false);
      }
    });
    actions.append(copy);

    if (hooks.forceSave !== undefined) {
      const save = document.createElement("button");
      save.type = "button";
      save.className = "debug-panel__btn";
      save.textContent = "Force save snapshot";
      save.addEventListener("click", () => {
        const ok = hooks.forceSave!();
        save.textContent = ok ? "Saved ✓" : "No active match";
        setTimeout(() => (save.textContent = "Force save snapshot"), 1500);
        refresh();
      });
      actions.append(save);
    }

    if (hooks.simulateReloadCheck !== undefined) {
      const sim = document.createElement("button");
      sim.type = "button";
      sim.className = "debug-panel__btn";
      sim.textContent = "Simulate reload check";
      sim.addEventListener("click", () => {
        const result = hooks.simulateReloadCheck!();
        sim.textContent = result;
        setTimeout(() => (sim.textContent = "Simulate reload check"), 2500);
      });
      actions.append(sim);
    }

    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "debug-panel__btn";
    refreshBtn.textContent = "Refresh";
    refreshBtn.addEventListener("click", () => refresh());
    actions.append(refreshBtn);

    if (hooks.onFeedback !== undefined) {
      const feedback = document.createElement("button");
      feedback.type = "button";
      feedback.className = "debug-panel__btn";
      feedback.textContent = "Send feedback";
      feedback.addEventListener("click", () => hooks.onFeedback!());
      actions.append(feedback);
    }

    body.append(actions);

    const note = document.createElement("p");
    note.className = "debug-panel__note";
    note.textContent =
      `Disable: set localStorage.${FLAG_DEBUG}=0 and reload. ` +
      "Test matrix: see docs/mobile-live-match-qa.md.";
    body.append(note);
  };

  refresh();
  return { element: panel, refresh };
}
