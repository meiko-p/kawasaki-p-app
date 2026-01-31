import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  Box,
  Divider,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import SearchIcon from '@mui/icons-material/Search';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import DescriptionIcon from '@mui/icons-material/Description';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import PrintIcon from '@mui/icons-material/Print';
import { useAuth } from '../contexts/AuthContext.jsx';

const NavItem = ({ to, icon, label, onClick }) => (
  <ListItemButton
    component={NavLink}
    to={to}
    onClick={onClick}
    sx={{
      '&.active': {
        backgroundColor: 'rgba(77,208,225,0.12)',
        borderLeft: '4px solid rgba(77,208,225,0.9)',
      },
    }}
  >
    <ListItemIcon>{icon}</ListItemIcon>
    <ListItemText primary={label} />
  </ListItemButton>
);

export default function SideNav({ open, onClose }) {
  const { role } = useAuth();
  const isStaff = role === 'staff' || role === 'admin';

  return (
    <Drawer open={open} onClose={onClose}>
      <Box sx={{ width: 300, p: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 900 }}>
          メニュー
        </Typography>
        <Typography sx={{ opacity: 0.7, mb: 1, fontSize: 12 }}>
          role: {role || '-'}
        </Typography>

        <Divider sx={{ mb: 1 }} />

        <List dense>
          <NavItem to="/" icon={<DashboardIcon />} label="ダッシュボード" onClick={onClose} />
          <NavItem to="/search" icon={<SearchIcon />} label="商品番号検索" onClick={onClose} />

          <Divider sx={{ my: 1 }} />
          <Typography sx={{ px: 2, py: 0.5, opacity: 0.7, fontSize: 12 }}>
            共有（川崎重工 + 社内）
          </Typography>

          <NavItem to="/products" icon={<QrCode2Icon />} label="商品" onClick={onClose} />
          <NavItem to="/plans" icon={<DescriptionIcon />} label="計画書（発注）" onClick={onClose} />
          <NavItem to="/packages" icon={<LocalShippingIcon />} label="梱包登録" onClick={onClose} />

          {isStaff && (
            <>
              <Divider sx={{ my: 1 }} />
              <Typography sx={{ px: 2, py: 0.5, opacity: 0.7, fontSize: 12 }}>
                社内専用
              </Typography>

              <NavItem to="/estimates" icon={<ReceiptLongIcon />} label="見積＆納品予定【スタート】" onClick={onClose} />
              <NavItem to="/dempyo" icon={<PrintIcon />} label="社内伝票（PDF）" onClick={onClose} />
              <NavItem to="/labels" icon={<QrCode2Icon />} label="ラベル【田中さん共有】" onClick={onClose} />
              <NavItem to="/inventory" icon={<Inventory2Icon />} label="在庫管理" onClick={onClose} />
            </>
          )}
        </List>
      </Box>
    </Drawer>
  );
}
