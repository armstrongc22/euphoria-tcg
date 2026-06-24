// Build-time env vars (Vite inlines anything prefixed VITE_). Declared locally
// so this package typechecks standalone without depending on Vite's client
// types. Mirrors apps/web/src/vite-env.d.ts; the web app supplies the real
// values at build time, and tests pass an env-like record explicitly.
interface ImportMetaEnv {
  readonly [key: string]: string | boolean | undefined;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Build stamp (commit SHA or timestamp) injected by vite.config.ts. */
  readonly VITE_BUILD_STAMP?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
