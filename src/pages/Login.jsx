import React, { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Link,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

import { useAuth } from '../contexts/AuthContext.jsx'; // パスはあなたの構成に合わせて調整してください

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();

  const { initializing, user, signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const redirectTo = useMemo(() => {
    // RequireAuth/RequireRole から来た場合
    const from = location.state?.from?.pathname;
    return typeof from === 'string' && from ? from : '/estimates';
  }, [location.state]);

  // 以前入力したemailだけは保存してもOK（パスワードは保存しない）
  useEffect(() => {
    try {
      const saved = localStorage.getItem('last_login_email');
      if (saved) setEmail(saved);
    } catch {
      // noop
    }
  }, []);

  // 既にログイン済みなら飛ばす
  useEffect(() => {
    if (!initializing && user) {
      navigate(redirectTo, { replace: true });
    }
  }, [initializing, user, navigate, redirectTo]);

  const onSubmit = async (e) => {
    // ★ これが無いと「入力後に画面が初期化される（リロード）」が起きます
    e.preventDefault();

    setBusy(true);
    setError('');

    const emailTrim = String(email || '').trim();
    const pass = String(password || '');

    if (!emailTrim || !pass) {
      setError('メールアドレスとパスワードを入力してください。');
      setBusy(false);
      return;
    }

    try {
      const { data, error: signInErr } = await signIn(emailTrim, pass);

      if (signInErr) {
        // Supabaseが返す本当の原因がここに入ります
        setError(signInErr.message || 'ログインに失敗しました');
        setBusy(false);
        return;
      }

      // emailだけ保存（パスワードは保存しない）
      try {
        localStorage.setItem('last_login_email', emailTrim);
      } catch {
        // noop
      }

      // signInWithPassword 成功なら data.session が入るはず
      if (data?.session) {
        navigate(redirectTo, { replace: true });
        return;
      }

      // 万一 session が無い場合も、AuthStateChangeで追従されるので一旦遷移してOK
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err?.message || 'ログイン処理中にエラーが発生しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ minHeight: '80vh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Paper sx={{ width: 'min(720px, 92vw)', p: 4 }}>
        <Stack spacing={2}>
          <Typography variant="h5" fontWeight={900}>
            ログイン
          </Typography>

          {error && <Alert severity="error">{error}</Alert>}

          <Box component="form" onSubmit={onSubmit}>
            <Stack spacing={2}>
              <TextField
                label="メールアドレス"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                fullWidth
              />
              <TextField
                label="パスワード"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                fullWidth
              />

              <Button
                type="submit"
                variant="contained"
                disabled={busy || initializing}
                fullWidth
                sx={{ py: 1.2, fontWeight: 900 }}
              >
                {busy ? 'ログイン中…' : 'ログイン'}
              </Button>

              <Link component={RouterLink} to="/signup" underline="hover" sx={{ textAlign: 'center' }}>
                新規登録へ
              </Link>
            </Stack>
          </Box>
        </Stack>
      </Paper>
    </Box>
  );
}
