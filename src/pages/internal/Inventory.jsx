import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';

export default function Inventory() {
  const [params] = useSearchParams();
  const filterProductId = params.get('product_id') || '';

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const [open, setOpen] = useState(false);
  const [adjProductId, setAdjProductId] = useState(filterProductId || '');
  const [adjQty, setAdjQty] = useState('');
  const [adjReason, setAdjReason] = useState('棚卸調整');

  const productsForSelect = useMemo(() => rows.map((r) => ({
    id: r.product_id,
    product_code: r.product_code,
    name: r.product_name,
  })), [rows]);

  const load = async () => {
    setLoading(true);
    const q = supabase
      .from('inventory_summary')
      .select('*')
      .order('product_code', { ascending: true });

    const { data, error } = filterProductId ? await q.eq('product_id', filterProductId) : await q;

    setLoading(false);
    if (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      alert('在庫取得に失敗しました');
      return;
    }
    setRows(data || []);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterProductId]);

  const adjust = async () => {
    const n = Number(adjQty);
    if (!adjProductId) {
      alert('商品を選択してください');
      return;
    }
    if (!Number.isFinite(n) || n === 0) {
      alert('調整数量を入力してください（0以外）');
      return;
    }

    const ok = window.confirm(`在庫を ${n} だけ調整します。よろしいですか？`);
    if (!ok) return;

    const { error } = await supabase.from('inventory_movements').insert({
      product_id: adjProductId,
      movement_type: 'ADJUST',
      quantity: n,
      reason: adjReason?.trim() || '棚卸調整',
      occurred_at: new Date().toISOString(),
      reference_table: 'manual',
      reference_id: null,
    });

    if (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      alert('調整に失敗しました');
      return;
    }

    setOpen(false);
    setAdjQty('');
    await load();
    alert('調整しました');
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 900, mb: 2 }}>
        在庫管理（社内）
      </Typography>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button onClick={load} variant="outlined">
            再読み込み
          </Button>
          <Button onClick={() => setOpen(true)}>
            棚卸調整（ADJUST）
          </Button>
          {loading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={18} />
              <Typography sx={{ opacity: 0.7 }}>読み込み中…</Typography>
            </Box>
          )}
        </Box>
        <Typography sx={{ mt: 1, opacity: 0.7, fontSize: 12 }}>
          入庫（IN）は伝票画面の「入庫確定」ボタンで登録されます。納品（OUT）は計画書の「納品済」更新で自動登録されます。
        </Typography>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>商品番号</TableCell>
              <TableCell>名称</TableCell>
              <TableCell align="right">在庫数</TableCell>
              <TableCell>最終更新</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.product_id} hover>
                <TableCell sx={{ fontWeight: 900 }}>{r.product_code}</TableCell>
                <TableCell>{r.product_name || '-'}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 900 }}>
                  {Number(r.qty_on_hand || 0).toLocaleString('ja-JP')}
                </TableCell>
                <TableCell>{(r.last_movement_at || '').slice(0, 19).replace('T', ' ')}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} sx={{ opacity: 0.7 }}>
                  データがありません。
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 900 }}>棚卸調整（ADJUST）</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 1.5, pt: 2 }}>
          <TextField
            select
            label="商品"
            value={adjProductId}
            onChange={(e) => setAdjProductId(e.target.value)}
          >
            {productsForSelect.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.product_code} {p.name || ''}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="調整数量（+増 / -減）"
            value={adjQty}
            onChange={(e) => setAdjQty(e.target.value)}
            placeholder="例: 10 / -5"
          />
          <TextField
            label="理由"
            value={adjReason}
            onChange={(e) => setAdjReason(e.target.value)}
          />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setOpen(false)} variant="outlined">キャンセル</Button>
          <Button onClick={adjust}>実行</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
