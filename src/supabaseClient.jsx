import { createClient } from '@supabase/supabase-js';

// ✅ import.meta.env には代入しない（読むだけ）
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // どっちが欠けているか分かるようにログも出す
  // （Vercel側でENV未設定のときに特に役立ちます）
  // eslint-disable-next-line no-console
  console.error('ENV CHECK', {
    VITE_SUPABASE_URL: supabaseUrl,
    VITE_SUPABASE_ANON_KEY: supabaseAnonKey ? '(set)' : '(missing)',
    MODE: import.meta.env.MODE,
  });
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
}

// HMR/差し替えを繰り返しても Supabase クライアントを1つに固定
const GLOBAL_KEY = '__kawasaki_print_portal_supabase__';

// ★安全運転モード：永続セッションを使わない（まず動かす）
// ※更新でログイン消えます。動作確認が優先の間はこれでOK。
export const supabase =
  globalThis[GLOBAL_KEY] ??
  createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: true,
    },
  });

if (!globalThis[GLOBAL_KEY]) {
  globalThis[GLOBAL_KEY] = supabase;
}

