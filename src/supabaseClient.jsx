import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL='https://kajzoimjgstpibpjzzys.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthanpvaW1qZ3N0cGlicGp6enlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgyODY0MjcsImV4cCI6MjA4Mzg2MjQyN30.Qc8_q-6g3O1Q9rAxMNLgA6LJ8_roB42kpjjc9KfX4ng';
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
}

// HMR/差し替えを繰り返しても Supabase クライアントを1つに固定
const GLOBAL_KEY = '__kawasaki_print_portal_supabase__';

// ★安全運転モード：永続セッションを使わない（getSessionハングを回避）
// ※ページ更新するとログインが消えます。まず開発を止めないのが目的です。
export const supabase =
  globalThis[GLOBAL_KEY] ??
  createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,     // ★ここが肝
      autoRefreshToken: false,   // ★ここも肝（裏でrefreshして固まるのを回避）
      detectSessionInUrl: true,
    },
  });

if (!globalThis[GLOBAL_KEY]) {
  globalThis[GLOBAL_KEY] = supabase;
}
