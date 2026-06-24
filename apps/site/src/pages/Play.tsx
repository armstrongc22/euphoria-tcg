import { PagePlaceholder } from "./PagePlaceholder";

/**
 * Placeholder for the TCG. The working battle engine + board live in the
 * existing beta (apps/web). Wiring the playable match into this React shell —
 * reusing @euphoria/core's play-match controller, with no engine changes — is
 * the next milestone after the shell is approved.
 */
export function Play() {
  return (
    <PagePlaceholder eyebrow="Trading Card Game" title="Play" tone="red">
      <p>
        The Euphoria TCG beta is playable today. Its rules engine, card effects,
        accounts, rewards, and match history are stable and untouched — they now
        live in the shared <code>@euphoria/core</code> package.
      </p>
      <p>
        <strong>Coming next:</strong> the live battle board is being brought into
        this new site by reusing the same <code>@euphoria/core</code> match
        controller — the engine and backend behavior stay exactly as they are in
        the current beta.
      </p>
      <p className="eu-note">
        In the meantime, the existing beta remains available and fully
        functional.
      </p>
    </PagePlaceholder>
  );
}
