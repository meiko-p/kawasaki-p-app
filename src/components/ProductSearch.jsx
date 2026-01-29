import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import {
  Box,
  Button,
  CircularProgress,
  Paper,
  TextField,
  Typography,
  List,
  ListItemButton,
  ListItemText,
} from '@mui/material';

/**
 * 商品番号検索（共通）
 * - product_code で部分一致検索
 * - クリックで商品詳細へ
 */
export default function ProductSearch({ initialQuery = '' }) {
  const [q, setQ] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const navigate = useNavigate();

  const canSearch = useMemo(() => (q || '').trim().length >= 2, [q]);

  const doSearch = async () => {
    if (!canSearch) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('products')
      .select('id, product_code, name, product_type, unit_price')
      .ilike('product_code', `%${q.trim()}%`)
      .order('product_code', { ascending: true })
      .limit(50);

    setLoading(false);
    if (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      alert('検索エラーが発生しました');
      return;
    }
    setRows(data || []);
  };

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ fontWeight: 900, mb: 1 }}>
        商品番号検索
      </Typography>

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <TextField
          fullWidth
          label="商品番号（例: 99817-0041 / FR651V など）"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button onClick={doSearch} disabled={!canSearch || loading}>
          検索
        </Button>
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2 }}>
          <CircularProgress size={18} />
          <Typography sx={{ opacity: 0.8 }}>検索中…</Typography>
        </Box>
      )}

      {!loading && rows.length > 0 && (
        <List sx={{ mt: 1 }}>
          {rows.map((r) => (
            <ListItemButton key={r.id} onClick={() => navigate(`/products/${r.id}`)}>
              <ListItemText
                primary={r.product_code}
                secondary={`${r.name || ''} / 種別: ${r.product_type} / 単価: ${r.unit_price ?? '-'} 円`}
              />
            </ListItemButton>
          ))}
        </List>
      )}

      {!loading && canSearch && rows.length === 0 && (
        <Typography sx={{ mt: 2, opacity: 0.75 }}>
          検索結果がありません。
        </Typography>
      )}

      {!loading && !canSearch && (
        <Typography sx={{ mt: 2, opacity: 0.65 }}>
          2文字以上入力して検索してください。
        </Typography>
      )}
    </Paper>
  );
}
