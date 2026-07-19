import { BETA_URL } from "../beta";
import { usePageTitle } from "../usePageTitle";

/**
 * /play — launcher for the TCG beta. The beta itself (apps/web) is bundled into
 * the same Cloudflare deployment under /beta/ and runs as its own app, so this
 * page is a thin entry point: it links out to /beta/ with a plain anchor (a real
 * navigation, not a React Router route). The prominent "Play Beta" buttons in the
 * nav/hero go straight to /beta/; this page is the landing for the section tab.
 */
export function Play() {
  usePageTitle("Play the Beta");
  return (
    <div className="eu-page eu-page--red">
      <p className="eu-page__eyebrow">Trading Card Game</p>
      <h1 className="eu-page__title">Play the Beta</h1>
      <div className="eu-page__body">
        <p>
          The Euphoria TCG beta is live and fully playable. Sign up, pick or build
          a deck, and battle a complete match — your account, match history, and
          reward progress persist.
        </p>
        <ul className="eu-play-list">
          <li>Sign up or log in — beta accounts take seconds to create</li>
          <li>Choose a starter deck or build your own</li>
          <li>Play a full match against the AI — win or lose</li>
          <li>Earn rewards at win milestones and track your collection</li>
        </ul>
        <p className="eu-play-cta">
          <a href={BETA_URL} className="eu-btn eu-btn--red">
            Launch the Beta
          </a>
        </p>
        <p className="eu-note">
          Opens the battle client in this window. Best experienced on a stable
          connection; progress is saved to your account.
        </p>
      </div>
    </div>
  );
}
