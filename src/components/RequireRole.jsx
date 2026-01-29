import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useAuth } from '../contexts/AuthContext.jsx';

function FullscreenLoader({ message = '権限を確認中…' }) {
  return (
    <Box sx={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}>
      <Stack spacing={2} alignItems="center">
        <CircularProgress />
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {message}
        </Typography>
      </Stack>
    </Box>
  );
}

export default function RequireRole({ allow = [], children }) {
  const { initializing, user, role, profileLoading, profileError, resetSession } = useAuth();
  const location = useLocation();

  if (initializing) return <FullscreenLoader message="認証を確認中…" />;

  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;

  // プロフィール取得中（ここが長くても「固定化」しないよう、loaderは出すがタイムアウトで落とさない）
  if (profileLoading) return <FullscreenLoader />;

  // profiles が取れない/RLSで弾かれた等（ここで延々スピナーにはしない）
  if (profileError) {
    return (
      <Box sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Alert severity="error">権限情報（profiles）が取得できません: {profileError}</Alert>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            RLSやprofilesのポリシー/データ不整合で role が取れないと、社内ページに入れません。
            まずは「セッションをリセット」→再ログインを試してください。
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button variant="contained" onClick={() => window.location.reload()}>
              再読み込み
            </Button>
            <Button
              variant="outlined"
              onClick={async () => {
                await resetSession();
                window.location.reload();
              }}
            >
              セッションをリセット
            </Button>
          </Stack>
        </Stack>
      </Box>
    );
  }

  // role 不一致 → 403
  if (allow.length > 0 && !allow.includes(role)) {
    return (
      <Box sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Typography variant="h4" fontWeight={900}>
            403 Forbidden
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            このページにアクセスする権限がありません。（role: {role || '未設定'}）
          </Typography>
          <Button variant="outlined" onClick={() => window.history.back()}>
            戻る
          </Button>
        </Stack>
      </Box>
    );
  }

  return children ? children : <Outlet />;
}
