import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';

import {
  Box,
  Divider,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
} from '@mui/material';

import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import AssignmentRoundedIcon from '@mui/icons-material/AssignmentRounded';
import CalculateRoundedIcon from '@mui/icons-material/CalculateRounded';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded';
import LabelRoundedIcon from '@mui/icons-material/LabelRounded';
import WarehouseRoundedIcon from '@mui/icons-material/WarehouseRounded';
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded';
import PriceChangeRoundedIcon from '@mui/icons-material/PriceChangeRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded';

const DRAWER_WIDTH = 320;

const MENU_ITEMS = [
  {
    label: 'ダッシュボード',
    path: '/',
    icon: <HomeRoundedIcon />,
    shared: true,
  },
  {
    label: '計画書（発注）【スタート】',
    path: '/order-plans',
    icon: <AssignmentRoundedIcon />,
    shared: true,
    emphasis: true,
  },
  {
    label: '見積作成',
    path: '/estimates',
    icon: <CalculateRoundedIcon />,
    staffOnly: true,
  },
  {
    label: '社内伝票（PDF）',
    path: '/dempyo',
    icon: <DescriptionRoundedIcon />,
    staffOnly: true,
  },
  {
    label: '梱包登録',
    path: '/packages',
    icon: <Inventory2RoundedIcon />,
    shared: true,
  },
  {
    label: 'ラベル【田中さん共有】',
    path: '/labels',
    icon: <LabelRoundedIcon />,
    staffOnly: true,
  },
  {
    label: '在庫管理',
    path: '/inventory',
    icon: <WarehouseRoundedIcon />,
    staffOnly: true,
  },
  {
    label: '見積＆納品数【確定提出分】',
    path: '/plans',
    icon: <FactCheckRoundedIcon />,
    shared: true,
  },
  {
    label: '単価登録【ロット単価・商品別単価】',
    path: '/products',
    icon: <PriceChangeRoundedIcon />,
    shared: true,
  },
  {
    label: '商品番号検索',
    path: '/search',
    icon: <SearchRoundedIcon />,
    shared: true,
  },
  {
    label: '製本スケジュール（3カ月）',
    path: '/binding-schedule',
    icon: <CalendarMonthRoundedIcon />,
    staffOnly: true,
  },
];

export default function SideNav({ open, onClose }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { role } = useAuth();

  const isStaff = role === 'staff' || role === 'admin';
  const visibleItems = MENU_ITEMS.filter((item) => !item.staffOnly || isStaff);

  const move = (path) => {
    navigate(path);
    onClose?.();
  };

  return (
    <Drawer
      anchor="left"
      open={Boolean(open)}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: DRAWER_WIDTH,
          bgcolor: 'background.paper',
          backgroundImage: 'none',
          borderRight: '1px solid rgba(255,255,255,0.08)',
        },
      }}
    >
      <Toolbar>
        <Box>
          <Typography variant="h6" fontWeight={900}>
            川崎重工 印刷ポータル
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            業務メニュー
          </Typography>
        </Box>
      </Toolbar>

      <Divider />

      <List sx={{ px: 1.2, py: 1.5 }}>
        {visibleItems.map((item) => {
          const selected =
            item.path === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.path);

          return (
            <ListItemButton
              key={item.path}
              selected={selected}
              onClick={() => move(item.path)}
              sx={{
                mb: 0.6,
                borderRadius: 2,
                border: item.emphasis
                  ? '1px solid rgba(77, 208, 225, 0.38)'
                  : '1px solid transparent',
                bgcolor: item.emphasis && !selected
                  ? 'rgba(77, 208, 225, 0.04)'
                  : undefined,
                '&.Mui-selected': {
                  bgcolor: 'rgba(77, 208, 225, 0.13)',
                  color: 'primary.light',
                },
                '&.Mui-selected:hover': {
                  bgcolor: 'rgba(77, 208, 225, 0.17)',
                },
              }}
            >
              <ListItemIcon
                sx={{
                  minWidth: 42,
                  color: selected || item.emphasis ? 'primary.light' : 'text.secondary',
                }}
              >
                {item.icon}
              </ListItemIcon>
              <ListItemText
                primary={item.label}
                primaryTypographyProps={{
                  fontWeight: item.emphasis ? 900 : selected ? 800 : 600,
                  fontSize: 14,
                }}
              />
            </ListItemButton>
          );
        })}
      </List>

      <Box sx={{ flex: 1 }} />

      <Divider />
      <Box sx={{ p: 2 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          「緊急時小ロット対応」はメニューから削除し、製本スケジュールへ置き換えています。
        </Typography>
      </Box>
    </Drawer>
  );
}
