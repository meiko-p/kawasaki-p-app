import React, { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Link,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function Register() {
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (password !== password2) {
      setError('パスワードが一致しません');
      return;
    }

    setLoading(true);
    try {
      const { data } = await signUp({ email, password });
      // Email Confirm がOFFなら session が返る場合があります
      if (data?.session) {
        navigate('/', { replace: true });
        return;
      }
      setSuccess('登録しました。メール確認が必要な設定の場合は、受信メールから確認してください。');
    } catch (err) {
      setError(err?.message || '登録に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ minHeight: '80vh', display: 'grid', placeItems: 'center' }}>
      <Paper sx={{ p: 3, width: 'min(520px, 92vw)' }}>
        <Typography variant="h5" sx={{ fontWeight: 900, mb: 1 }}>
          新規登録（社内）
        </Typography>

        <Typography sx={{ opacity: 0.75, mb: 2 }}>
          登録直後に `role=staff` が自動で付与されます（Supabaseトリガー）。
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

        <Box component="form" onSubmit={onSubmit} sx={{ display: 'grid', gap: 1.5 }}>
          <TextField
            label="メールアドレス"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
          <TextField
            label="パスワード"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <TextField
            label="パスワード（確認）"
            type="password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            required
          />
          <Button type="submit" disabled={loading}>
            {loading ? '登録中…' : '登録'}
          </Button>
        </Box>

        <Box sx={{ mt: 2 }}>
          <Link component={RouterLink} to="/login">
            ログインへ戻る
          </Link>
        </Box>
      </Paper>
    </Box>
  );
}
