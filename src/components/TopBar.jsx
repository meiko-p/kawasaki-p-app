import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AppBar,
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  TextField,
  Toolbar,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import SearchIcon from '@mui/icons-material/Search';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function TopBar({ onOpenNav }) {
  const { profile, role, signOut } = useAuth();
  const [anchorEl, setAnchorEl] = useState(null);
  const [q, setQ] = useState('');
  const navigate = useNavigate();

  const open = Boolean(anchorEl);

  const doSearch = () => {
    const s = (q || '').trim();
    if (!s) return;
    navigate(`/search?q=${encodeURIComponent(s)}`);
  };

  return (
    <AppBar
      position="sticky"
      color="transparent"
      elevation={0}
      sx={(theme) => ({
        // ✅ 60% 透過の“帯”を作る
        backgroundColor: alpha(theme.palette.background.default, 0.6),

        // ✅ 背景が透けても読みやすくする（任意だけどおすすめ）
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',

        // 境界線
        borderBottom: `1px solid ${alpha(theme.palette.common.white, 0.08)}`,

        // 念のため（他の要素に負けないように）
        zIndex: theme.zIndex.appBar,
      })}
    >
      <Toolbar sx={{ gap: 2 }}>
        <Button onClick={onOpenNav} variant="outlined" sx={{ minWidth: 92 }}>
          メニュー
        </Button>

        <Typography variant="h6" sx={{ fontWeight: 900, letterSpacing: 0.5 }}>
          川崎重工 印刷ポータル
        </Typography>

        <Box sx={{ flex: 1 }} />

        {/* 検索 */}
        <Box sx={{ display: { xs: 'none', md: 'flex' }, gap: 1, alignItems: 'center', width: 420 }}>
          <TextField
            size="small"
            fullWidth
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="商品番号で検索…"
            onKeyDown={(e) => {
              if (e.key === 'Enter') doSearch();
            }}
            sx={(theme) => ({
              // 入力欄も少しだけ背景を付けるとさらに読みやすい（不要なら消してOK）
              '& .MuiOutlinedInput-root': {
                backgroundColor: alpha(theme.palette.background.paper, 0.35),
              },
            })}
          />
          <IconButton onClick={doSearch} title="検索">
            <SearchIcon />
          </IconButton>
        </Box>

        {/* ユーザメニュー */}
        <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} title="ユーザ">
          <AccountCircleIcon />
        </IconButton>
        <Menu anchorEl={anchorEl} open={open} onClose={() => setAnchorEl(null)}>
          <MenuItem disabled>
            <Box>
              <Typography sx={{ fontWeight: 800 }}>
                {profile?.display_name || profile?.email || '(no name)'}
              </Typography>
              <Typography sx={{ opacity: 0.7, fontSize: 12 }}>
                role: {role || '-'}
              </Typography>
            </Box>
          </MenuItem>
          <MenuItem
            onClick={() => {
              setAnchorEl(null);
              navigate('/');
            }}
          >
            ダッシュボード
          </MenuItem>
          <MenuItem
            onClick={async () => {
              setAnchorEl(null);
              await signOut();
              navigate('/login');
            }}
          >
            ログアウト
          </MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  );
}
