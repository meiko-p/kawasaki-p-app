import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';

import { Box } from '@mui/material';

import TopBar from './TopBar.jsx';
import SideNav from './SideNav.jsx';

export default function Layout() {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <TopBar onOpenNav={() => setNavOpen(true)} />
      <SideNav open={navOpen} onClose={() => setNavOpen(false)} />

      <Box
        component="main"
        sx={{
          minHeight: 'calc(100vh - 64px)',
          width: '100%',
          overflowX: 'hidden',
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
}
