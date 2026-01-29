import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Typography,
} from '@mui/material';
import { useAuth } from '../../contexts/AuthContext.jsx';

export default function ProductDetail() {
  const { id } = useParams();
  const { role } = useAuth();
  const isStaff = role === 'staff' || role === 'admin';

  const navigate = useNavigate();
  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('products').select('*').eq('id', id).single();
    setLoading(false);
    if (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      alert('商品が見つかりません');
      navigate('/products');
      return;
    }
    setRow(data);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const typeLabel = useMemo(() => {
    if (!row) return '';
    return row.product_type === 'OM' ? 'OM' : '小型エンジン';
  }, [row]);

  if (loading) {
    return (
      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CircularProgress size={18} />
          <Typography sx={{ opacity: 0.7 }}>読み込み中…</Typography>
        </Box>
      </Paper>
    );
  }

  if (!row) return null;

  return (
    <Box>
      <Paper sx={{ p: 2.5, mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 900 }}>
          {row.product_code}
        </Typography>
        <Typography sx={{ opacity: 0.8, mb: 1 }}>
          {row.name || ''}
        </Typography>

        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip label={`種別: ${typeLabel}`} variant="outlined" />
          <Chip
            label={`単価: ${row.unit_price == null ? '-' : Number(row.unit_price).toLocaleString('ja-JP') + ' 円'}`}
            variant="outlined"
            color="primary"
          />
          {row.active
            ? <Chip label="有効" variant="outlined" color="success" />
            : <Chip label="停止" variant="outlined" />
          }
        </Box>

        <Divider sx={{ my: 2 }} />

        <Typography sx={{ fontWeight: 900, mb: 1 }}>
          操作
        </Typography>

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="outlined" onClick={() => navigate(`/plans?product_id=${encodeURIComponent(row.id)}`)}>
            計画書（この商品）
          </Button>
          <Button variant="outlined" onClick={() => navigate(`/packages?product_id=${encodeURIComponent(row.id)}`)}>
            梱包登録（この商品）
          </Button>

          {isStaff && (
            <>
              <Button variant="outlined" onClick={() => navigate(`/inventory?product_id=${encodeURIComponent(row.id)}`)}>
                在庫（社内）
              </Button>
              <Button variant="outlined" onClick={() => navigate(`/labels?product_id=${encodeURIComponent(row.id)}`)}>
                ラベル作成（社内）
              </Button>
              <Button variant="outlined" onClick={() => navigate(`/estimates?product_id=${encodeURIComponent(row.id)}`)}>
                見積（社内）
              </Button>
              <Button variant="outlined" onClick={() => navigate(`/dempyo?estimate_product_id=${encodeURIComponent(row.id)}`)}>
                伝票（社内）
              </Button>
            </>
          )}
        </Box>
      </Paper>

      <Paper sx={{ p: 2.5 }}>
        <Typography sx={{ fontWeight: 900, mb: 1 }}>補足</Typography>
        <Typography sx={{ opacity: 0.75 }}>
          「商品番号検索」から本ページへアクセスし、ここを起点に必要な機能へ遷移できます。
        </Typography>
      </Paper>
    </Box>
  );
}
