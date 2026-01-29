import React from 'react';
import { Box, Typography } from '@mui/material';

/**
 * 「済」ハンコ風のスタンプ
 */
export default function Stamp({ label = '済', size = 56 }) {
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: '3px solid rgba(255,80,80,0.95)',
        display: 'grid',
        placeItems: 'center',
        transform: 'rotate(-12deg)',
        boxShadow: '0 0 0 2px rgba(255,80,80,0.25) inset',
      }}
    >
      <Typography
        sx={{
          fontWeight: 900,
          color: 'rgba(255,80,80,0.95)',
          letterSpacing: 1,
          fontSize: size * 0.42,
          lineHeight: 1,
        }}
      >
        {label}
      </Typography>
    </Box>
  );
}
