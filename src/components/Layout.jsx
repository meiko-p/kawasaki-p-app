import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Box } from '@mui/material';
import TopBar from './TopBar.jsx';
import SideNav from './SideNav.jsx';

export default function Layout() {
  const [openNav, setOpenNav] = useState(false);

  return (
    <Box sx={{ minHeight: '100vh' }}>
      <TopBar onOpenNav={() => setOpenNav(true)} />
      <SideNav open={openNav} onClose={() => setOpenNav(false)} />

      <Box sx={{ p: { xs: 1.5, md: 3 } }}>
        <Outlet />
      </Box>
    </Box>
  );
}
