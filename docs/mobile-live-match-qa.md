# Mobile live-match QA (stability)

Manual check for the mobile forced-refresh fix (long live/manual matches).

## Why this matters

On mobile the live match could force-refresh/reload after ~12–15 turns. Root
cause: the battle log re-rendered the **entire** match history on every repaint
(every action and every opponent-playback step), so the live container's DOM
grew without bound and the mobile browser killed the tab under memory pressure.

The fix caps the **rendered** battle-log rows (`MAX_RENDERED_LOG_ENTRIES`, latest
60) while keeping the full history in the engine/log; it also guarantees playback
timers and transient overlay nodes (attack beam) are cleaned up.

## How to test on mobile

1. Open the site on a phone (or a desktop browser in mobile-emulation mode) and
   sign in.
2. Start a live match (Account → **Play match**, or the Deck Builder's Play
   button).
3. Play **20+ turns** — summon, attack, end turn through several opponent turns.
4. Watch for an unexpected reload/refresh of the page. Expected: **no reload**;
   the match keeps playing smoothly.
5. Confirm the battle log still shows recent history with a
   "Showing the latest 60 of N events." note once the match is long enough — the
   log should not keep growing taller indefinitely.
6. If you have remote debugging (Safari Web Inspector / Chrome `chrome://inspect`)
   attached, watch the console for errors and the Elements panel for the live
   match container's node count — it should stabilise, not climb every turn.

## If a reload still occurs

A full in-match **resume** ("Resume match?") was intentionally deferred (see the
PR notes): the engine state isn't trivially serialisable, so a safe resume needs
deterministic action-replay persistence (record the player's `GameAction`s + seed,
re-apply on reload). The current change removes the growth that caused the
reload; if a reload is still observed after this fix, capture the turn count,
device/browser, and any console output and file a follow-up so we can prioritise
the replay-based resume.
