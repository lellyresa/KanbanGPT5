import { supabase } from './supabase';
(window as any)._probe = async () => {
  console.log('[probe] querying boards…');
  return supabase.from('boards').select('id').limit(1);
};
