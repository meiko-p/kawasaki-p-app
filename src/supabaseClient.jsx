import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
}

// HMRや複数importでも1回だけ作る
const GLOBAL_KEY = '__kawasaki_print_portal_supabase__';

export const supabase =
  globalThis[GLOBAL_KEY] ??
  createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

if (!globalThis[GLOBAL_KEY]) {
  globalThis[GLOBAL_KEY] = supabase;
}
