import { createClient } from '@supabase/supabase-js';

type WindowEnv = {
  url: string;
  anon: string;
};

// Make this module-scoped so the global augmentation is applied.
export {};

declare global {
  interface Window {
    _env: WindowEnv;
    supabase: ReturnType<typeof createClient>;
  }
}

const url  = import.meta.env.VITE_SUPABASE_URL!;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY!;

// Guard so this file doesn't blow up during SSR / tests
if (typeof window !== "undefined") {
  // ✅ add these
  window._env = { url, anon };
  console.log('[env]', { hasUrl: !!url, hasAnon: !!anon, urlPreview: url?.slice(0, 32) });
}

export const supabase = createClient(url.replace(/\/+$/, ''), anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Guard so this file doesn't blow up during SSR / tests
if (typeof window !== "undefined") {
  // optional: handy for console pokes
  window.supabase = supabase;
  console.log('[supabase] client created');
}
