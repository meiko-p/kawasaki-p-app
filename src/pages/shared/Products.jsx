import React, { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  MenuItem,
} from '@mui/material';
import { useAuth } from '../../contexts/AuthContext.jsx';

const PRODUCT_TYPES = [
  { value: 'OM', label: 'OM（オーナーズマニュアル）' },
  { value: 'ENGINE', label: '小型エンジン冊子' },
];

export default function Products() {
  const { role } = useAuth();
  const isStaff = role === 'staff' || role === 'admin';

  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  // dialog state
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    product_code: '',
    name: '',
    product_type: 'OM',
    unit_price: '',
    active: true,
  });

  const canSave = useMemo(() => {
    return (form.product_code || '').trim().length > 0 && (form.product_type || '').trim().length > 0;
  }, [form]);

  const load = async () => {
    setLoading(true);
    const query = supabase
      .from('products')
      .select('*')
      .order('product_code', { ascending: true })
      .limit(200);

    const s = (q || '').trim();
    const { data, error } = s ? await query.ilike('product_code', `%${s}%`) : await query;

    setLoading(false);
    if (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      alert('取得エラーが発生しました');
      return;
    }
    setRows(data || []);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openNew = () => {
    setEditing(null);
    setForm({ product_code: '', name: '', product_type: 'OM', unit_price: '', active: true });
    setOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      product_code: row.product_code || '',
      name: row.name || '',
      product_type: row.product_type || 'OM',
      unit_price: row.unit_price ?? '',
      active: !!row.active,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!canSave) return;

    const payload = {
      product_code: form.product_code.trim(),
      name: form.name?.trim() || null,
      product_type: form.product_type,
      unit_price: form.unit_price === '' ? null : Number(form.unit_price),
      active: !!form.active,
    };

    if (!isStaff) {
      alert('編集権限がありません（社内のみ）');
      return;
    }

    if (editing?.id) {
      const { error } = await supabase.from('products').update(payload).eq('id', editing.id);
      if (error) {
        // eslint-disable-next-line no-console
        console.error(error);
        alert('更新に失敗しました');
        return;
      }
    } else {
      const { error } = await supabase.from('products').insert(payload);
      if (error) {
        // eslint-disable-next-line no-console
        console.error(error);
        alert('追加に失敗しました（商品番号の重複など）');
        return;
      }
    }

    setOpen(false);
    await load();
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 900, mb: 2 }}>
        商品マスタ
      </Typography>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            label="商品番号で検索"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            sx={{ minWidth: 320 }}
          />
          <Button onClick={load} variant="outlined">
            再検索
          </Button>

          <Box sx={{ flex: 1 }} />

          {isStaff && (
            <Button onClick={openNew}>
              新規商品
            </Button>
          )}
        </Box>
      </Paper>

      <Paper sx={{ p: 2 }}>
        {loading ? (
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <CircularProgress size={18} />
            <Typography sx={{ opacity: 0.7 }}>読み込み中…</Typography>
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>商品番号</TableCell>
                <TableCell>名称</TableCell>
                <TableCell>種別</TableCell>
                <TableCell align="right">単価（円）</TableCell>
                <TableCell>状態</TableCell>
                <TableCell>詳細</TableCell>
                {isStaff && <TableCell>編集</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell sx={{ fontWeight: 800 }}>{r.product_code}</TableCell>
                  <TableCell>{r.name || '-'}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={r.product_type === 'OM' ? 'OM' : '小型エンジン'}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell align="right">
                    {r.unit_price == null ? '-' : Number(r.unit_price).toLocaleString('ja-JP')}
                  </TableCell>
                  <TableCell>
                    {r.active ? <Chip size="small" label="有効" color="success" variant="outlined" /> : <Chip size="small" label="停止" variant="outlined" />}
                  </TableCell>
                  <TableCell>
                    <Button component={RouterLink} to={`/products/${r.id}`} variant="outlined" size="small">
                      開く
                    </Button>
                  </TableCell>
                  {isStaff && (
                    <TableCell>
                      <Button onClick={() => openEdit(r)} size="small" variant="outlined">
                        編集
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={isStaff ? 7 : 6} sx={{ opacity: 0.7 }}>
                    データがありません。
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Paper>

      {/* New/Edit dialog */}
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 900 }}>
          {editing ? '商品編集' : '商品追加'}
        </DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 1.5, pt: 2 }}>
          <TextField
            label="商品番号（必須）"
            value={form.product_code}
            onChange={(e) => setForm((p) => ({ ...p, product_code: e.target.value }))}
            required
            helperText="例: O/M ZR900S  99817-0041 / FR651V/691V/730V 7ヵ国合本"
          />
          <TextField
            label="名称"
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          />
          <TextField
            select
            label="種別"
            value={form.product_type}
            onChange={(e) => setForm((p) => ({ ...p, product_type: e.target.value }))}
          >
            {PRODUCT_TYPES.map((t) => (
              <MenuItem key={t.value} value={t.value}>
                {t.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="単価（円）"
            value={form.unit_price}
            onChange={(e) => setForm((p) => ({ ...p, unit_price: e.target.value }))}
            placeholder="見積の単価を反映"
          />
          <TextField
            select
            label="状態"
            value={form.active ? '1' : '0'}
            onChange={(e) => setForm((p) => ({ ...p, active: e.target.value === '1' }))}
          >
            <MenuItem value="1">有効</MenuItem>
            <MenuItem value="0">停止</MenuItem>
          </TextField>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setOpen(false)} variant="outlined">
            キャンセル
          </Button>
          <Button onClick={save} disabled={!canSave}>
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
