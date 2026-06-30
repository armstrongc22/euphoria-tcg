/**
 * URL of the bundled TCG beta. The beta (apps/web) is built into
 * apps/site/dist/beta and served as a static app at `<base>beta/` on the same
 * Cloudflare origin as the site — so it's a real navigation (plain <a href>),
 * NOT a React Router route. Using BASE_URL keeps it correct under any base path.
 *
 * Note: in `site:dev` the beta isn't served by the site's dev server (run
 * `npm run web:dev` separately, or `npm run build:hosted && npm run site:preview`
 * to exercise the bundled `/beta/` path locally).
 */
export const BETA_URL = `${import.meta.env.BASE_URL}beta/`;
