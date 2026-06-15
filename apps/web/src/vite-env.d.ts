/// <reference types="vite/client" />

// Project-specific build-time env vars (see supabase-config.ts). Declaring them
// here gives import.meta.env strong typing without weakening Vite's defaults.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
