import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import ProductSearch from '../components/ProductSearch.jsx';

export default function Search() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 900, mb: 2 }}>
        商品番号検索
      </Typography>
      <ProductSearch initialQuery={q} />
    </Box>
  );
}
