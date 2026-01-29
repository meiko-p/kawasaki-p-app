import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useAuth } from '../contexts/AuthContext.jsx';

function FullscreenLoader({ message = '読み込み中…' }) {
  return (
    <Box sx={{ minHeight: '70vh', display: 'grid', placeItems: 'center' }}>
      <Stack spacing={2} alignItems="center">
        <CircularProgress />
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {message}
        </Typography>
      </Stack>
    </Box>
  );
}

export default function RequireAuth({ children }) {
  const { initializing, initError, user, resetSession } = useAuth();
  const location = useLocation();

  if (initializing) return <FullscreenLoader />;

  // 初期化そのものが失敗した場合（getSessionがエラーを返した等）
  if (initError) {
    return (
      <Box sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Alert severity="error">
            認証の初期化に失敗しました: {initError}
          </Alert>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            セッション情報が壊れている可能性があります。「セッションをリセット」→「再読み込み」を試してください。
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

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children ? children : <Outlet />;
}
