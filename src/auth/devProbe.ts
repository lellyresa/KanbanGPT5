import { supabase } from './supabase';

type ProbeResult = {
  data: unknown[] | null;
  error: Error | null;
};

// Make this module-scoped so the global augmentation is applied.
export {};

declare global {
  interface Window {
    _probe: () => Promise<ProbeResult>;
  }
}

// Guard so this file doesn't blow up during SSR / tests
if (typeof window !== "undefined") {
  window._probe = async () => {
    console.log('[probe] querying boards…');
    try {
      const { data, error } = await supabase.from('boards').select('id').limit(1);
      return { data, error };
    } catch (err) {
      return { data: null, error: err as Error };
    }
  };
}
