import { supabase } from './supabase';

type ProbeResult = {
  data: unknown[] | null;
  error: Error | null;
};

declare global {
  interface Window {
    _probe: () => Promise<ProbeResult>;
  }
}
export {}; // make this a module so the declaration merges

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
