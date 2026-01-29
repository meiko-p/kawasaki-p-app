import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient.jsx';

const AuthContext = createContext(null);

const PROFILE_SELECT = 'id, email, role, created_at';

function normalizeRole(role) {
  if (role === null || role === undefined) return null;
  const s = String(role).trim();
  if (!s) return null;
  return s; // そのまま返す（"staff" / "admin" 想定）
}

export function AuthProvider({ children }) {
  const [initializing, setInitializing] = useState(true);
  const [initError, setInitError] = useState('');

  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);

  const [profile, setProfile] = useState(null);
  const [role, setRole] = useState(null);

  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');

  // 「同じユーザーの profile を無駄に連続取得しない」ためのref
  const lastProfileUidRef = useRef(null);

  const clearProfileState = useCallback(() => {
    setProfile(null);
    setRole(null);
    setProfileError('');
    setProfileLoading(false);
    lastProfileUidRef.current = null;
  }, []);

  const loadProfile = useCallback(async (uid) => {
    const userId = String(uid || '').trim();
    if (!userId) {
      clearProfileState();
      return null;
    }

    // 同じUIDで既にロード済みなら再取得しない（必要なら手動リロード可能）
    if (lastProfileUidRef.current === userId && !profileError) {
      return profile;
    }

    setProfileLoading(true);
    setProfileError('');

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select(PROFILE_SELECT)
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        setProfile(null);
        setRole(null);
        setProfileError(error.message || 'プロフィール取得に失敗しました');
        lastProfileUidRef.current = userId;
        return null;
      }

      setProfile(data || null);
      setRole(normalizeRole(data?.role));
      lastProfileUidRef.current = userId;
      return data || null;
    } finally {
      setProfileLoading(false);
    }
  }, [clearProfileState, profile, profileError]);

  // 初期化：最初の1回だけ
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setInitializing(true);
      setInitError('');

      try {
        const { data, error } = await supabase.auth.getSession();
        if (cancelled) return;

        if (error) {
          setInitError(error.message || 'セッション取得に失敗しました');
          setSession(null);
          setUser(null);
          clearProfileState();
          return;
        }

        const sess = data?.session ?? null;
        setSession(sess);
        setUser(sess?.user ?? null);

        if (sess?.user?.id) {
          await loadProfile(sess.user.id);
        } else {
          clearProfileState();
        }
      } catch (e) {
        if (cancelled) return;
        setInitError(e?.message || '認証初期化に失敗しました');
        setSession(null);
        setUser(null);
        clearProfileState();
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();

    // 認証状態変化購読（トークン更新/ログアウト/ログイン）
    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (cancelled) return;

      setSession(nextSession ?? null);
      setUser(nextSession?.user ?? null);

      // 重要：ここで initializing を true に戻さない（全画面スピナー固定を防ぐ）
      if (nextSession?.user?.id) {
        const uid = nextSession.user.id;
        if (uid !== lastProfileUidRef.current) {
          await loadProfile(uid);
        }
      } else {
        clearProfileState();
      }
    });

    return () => {
      cancelled = true;
      try {
        listener?.subscription?.unsubscribe?.();
      } catch {
        // noop
      }
    };
  }, [clearProfileState, loadProfile]);

  // Login が呼ぶ用：必ず signIn を提供する
  const signIn = useCallback(async (email, password) => {
    setInitError('');
    const e = String(email || '').trim();
    const p = String(password || '');

    // supabase-js v2
    if (typeof supabase.auth.signInWithPassword === 'function') {
      return await supabase.auth.signInWithPassword({ email: e, password: p });
    }

    // 念のため v1 fallback（環境差異対策）
    if (typeof supabase.auth.signIn === 'function') {
      // v1は { email, password } でOK
      return await supabase.auth.signIn({ email: e, password: p });
    }

    return { data: null, error: new Error('Supabase AuthのsignIn関数が見つかりません') };
  }, []);

  const signOut = useCallback(async () => {
    setInitError('');
    try {
      // v2
      if (typeof supabase.auth.signOut === 'function') {
        return await supabase.auth.signOut();
      }
      return { error: null };
    } catch (e) {
      return { error: e };
    }
  }, []);

  // “セッションをリセット” ボタン用（ローカルの壊れたトークンを捨てる）
  const resetSession = useCallback(async () => {
    try {
      // v2: scope local が通る場合
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      try {
        await supabase.auth.signOut();
      } catch {
        // ignore
      }
    }

    // SupabaseのlocalStorageキーを可能な範囲で削除
    try {
      const keys = Object.keys(window.localStorage || {});
      for (const k of keys) {
        if (k.startsWith('sb-') && k.includes('auth-token')) {
          window.localStorage.removeItem(k);
        }
      }
    } catch {
      // ignore
    }

    setSession(null);
    setUser(null);
    clearProfileState();
    setInitError('');
  }, [clearProfileState]);

  const value = useMemo(
    () => ({
      initializing,
      initError,
      session,
      user,
      profile,
      role,
      profileLoading,
      profileError,
      signIn,
      signOut,
      resetSession,
      reloadProfile: async () => (user?.id ? loadProfile(user.id) : null),
    }),
    [
      initializing,
      initError,
      session,
      user,
      profile,
      role,
      profileLoading,
      profileError,
      signIn,
      signOut,
      resetSession,
      loadProfile,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
