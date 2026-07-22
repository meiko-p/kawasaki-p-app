import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  InputAdornment,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';

import SearchRoundedIcon from '@mui/icons-material/SearchRounded';

const PRODUCT_TYPE_LABELS = {
  ENGINE: '小型エンジン',
  OM: 'O/M',
  OTHER: 'その他',
};

function productTypeLabel(value) {
  return PRODUCT_TYPE_LABELS[value] || value || '';
}

export default function Search() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { role } = useAuth();
  const isStaff = role === 'staff' || role === 'admin';

  const [query, setQuery] = useState(params.get('q') || '');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const normalizedQuery = useMemo(() => query.trim(), [query]);

  const search = async (value = normalizedQuery) => {
    const keyword = String(value || '').trim();
    setLoading(true);
    setError('');

    try {
      let request = supabase
        .from('products')
        .select(
          'id, product_code, name, product_type, unit_price, active, plan_registered, created_at, updated_at',
        )
        .eq('active', true)
        .eq('plan_registered', true)
        .order('product_code', { ascending: true })
        .limit(300);

      if (keyword) {
        const escaped = keyword.replace(/[%_]/g, (character) => `\\${character}`);
        request = request.or(
          `product_code.ilike.%${escaped}%,name.ilike.%${escaped}%`,
        );
      }

      const { data, error: fetchError } = await request;
      if (fetchError) throw fetchError;
      setRows(data || []);
      setParams(keyword ? { q: keyword } : {});
    } catch (searchError) {
      // eslint-disable-next-line no-console
      console.error(searchError);
      setError(searchError?.message || '商品番号検索に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    search(params.get('q') || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openPath = (path, productId) => {
    const separator = path.includes('?') ? '&' : '?';
    navigate(`${path}${separator}product_id=${encodeURIComponent(productId)}`);
  };

  return (
    <Box sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h4" fontWeight={900}>
            商品番号検索
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
            計画書（発注）に登録済みの品番だけを検索します。
          </Typography>
        </Box>

        {error && <Alert severity="error">{error}</Alert>}

        <Paper sx={{ p: 2 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
            <TextField
              fullWidth
              label="品番・商品名で検索"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') search();
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRoundedIcon />
                  </InputAdornment>
                ),
              }}
            />
            <Button variant="contained" onClick={() => search()} sx={{ minWidth: 140 }}>
              検索
            </Button>
            <Button
              variant="outlined"
              onClick={() => {
                setQuery('');
                search('');
              }}
              sx={{ minWidth: 120 }}
            >
              全件表示
            </Button>
          </Stack>
        </Paper>

        <Paper sx={{ p: 2 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="h6" fontWeight={900} sx={{ flex: 1 }}>
              検索結果
            </Typography>
            <Chip label={`${rows.length}件`} variant="outlined" />
            {loading && <CircularProgress size={18} />}
          </Stack>

          <Divider sx={{ my: 2 }} />

          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 1150 }}>
              <TableHead>
                <TableRow>
                  <TableCell>品番</TableCell>
                  <TableCell>商品種類</TableCell>
                  <TableCell>商品名</TableCell>
                  <TableCell>単価</TableCell>
                  <TableCell>計画登録</TableCell>
                  <TableCell align="right">各機能へ</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell sx={{ fontWeight: 900 }}>{row.product_code}</TableCell>
                    <TableCell>{productTypeLabel(row.product_type)}</TableCell>
                    <TableCell>{row.name || '-'}</TableCell>
                    <TableCell>
                      {row.unit_price != null
                        ? `${Number(row.unit_price).toLocaleString('ja-JP')}円`
                        : '-'}
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label="計画書登録済み" color="success" />
                    </TableCell>
                    <TableCell align="right">
                      <Stack
                        direction="row"
                        spacing={0.7}
                        justifyContent="flex-end"
                        flexWrap="wrap"
                        useFlexGap
                      >
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => navigate('/order-plans')}
                        >
                          計画書
                        </Button>

                        {isStaff && (
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => navigate(`/estimates?product_id=${row.id}`)}
                          >
                            見積
                          </Button>
                        )}

                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => openPath('/packages', row.id)}
                        >
                          梱包
                        </Button>

                        {isStaff && (
                          <>
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => openPath('/labels', row.id)}
                            >
                              ラベル
                            </Button>
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => openPath('/inventory', row.id)}
                            >
                              在庫
                            </Button>
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() =>
                                navigate(`/binding-schedule?product_id=${row.id}`)
                              }
                            >
                              製本予定
                            </Button>
                          </>
                        )}

                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => navigate(`/products/${row.id}`)}
                        >
                          単価
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}

                {!loading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} sx={{ textAlign: 'center', color: 'text.secondary' }}>
                      該当する計画書登録済み品番がありません。
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Box>
        </Paper>
      </Stack>
    </Box>
  );
}
