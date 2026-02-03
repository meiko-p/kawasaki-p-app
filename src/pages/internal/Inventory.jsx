import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient.jsx';

import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Divider,
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

const PLAN_TABLE = 'delivery_plans';

function safeNum(v) {
  const s = String(v ?? '').trim();
  if (!s) return 0;
  const normalized = s.replace(/,/g, '').replace(/[^\d.-]/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}
function toInt(v) {
  return Math.max(0, Math.floor(safeNum(v)));
}

function packText(qty, lotQty) {
  const q = toInt(qty);
  const l = toInt(lotQty);
  if (q <= 0) return '-';
  if (l <= 0) return 'ロット未設定';
  const packs = Math.ceil(q / l);
  const rem = q % l;
  if (rem === 0) return `${l}×${packs}包`;
  return `${l}×${packs}包（最終包${rem}冊）`;
}

function DoneStamp() {
  return (
    <Box
      sx={{
        position: 'absolute',
        right: 16,
        top: 16,
        width: 96,
        height: 96,
        borderRadius: '50%',
        border: '5px solid rgba(255, 64, 64, 0.75)',
        color: 'rgba(255, 64, 64, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: 'rotate(-12deg)',
        fontWeight: 900,
        fontSize: 38,
        letterSpacing: 2,
        userSelect: 'none',
      }}
    >
      済
    </Box>
  );
}

function normalizeLines(lines) {
  const out = [];
  for (const r of Array.isArray(lines) ? lines : []) {
    const date = String(r?.date ?? '').trim();
    const qty = toInt(r?.qty);
    if (!date && qty <= 0) continue;
    out.push({
      id: String(r?.id || `line-${Date.now()}-${Math.random()}`),
      date,
      qty,
    });
  }
  return out;
}

export default function Inventory() {
  const [params] = useSearchParams();
  const filterProductId = params.get('product_id') || '';
  const navigate = useNavigate();

  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 保存された plan_json（丸ごと保持して、棚番号だけ更新して再保存）
  const [planJson, setPlanJson] = useState(null);
  const [lastSavedAt, setLastSavedAt] = useState('');

  // Inventory側入力（棚番号）
  const [shelfNo, setShelfNo] = useState('');

  const meta = useMemo(() => planJson?.meta || {}, [planJson]);
  const lines = useMemo(() => normalizeLines(planJson?.lines || []), [planJson]);

  const totalQty = useMemo(() => toInt(meta?.totalQty), [meta?.totalQty]);
  const lotQty = useMemo(() => toInt(meta?.lotQty), [meta?.lotQty]);

  const plannedSum = useMemo(() => lines.reduce((s, r) => s + toInt(r.qty), 0), [lines]);
  const stockQty = useMemo(() => {
    const v = totalQty - plannedSum;
    return Number.isFinite(v) ? v : 0;
  }, [totalQty, plannedSum]);

  const isDone = useMemo(() => totalQty > 0 && stockQty <= 0, [totalQty, stockQty]);

  // ========== products load ==========
  const loadProducts = async () => {
    const { data, error: e } = await supabase
      .from('products')
      .select('id, product_code, name')
      .eq('active', true)
      .order('product_code', { ascending: true })
      .limit(1000);

    if (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      setError(e.message || '商品マスタの取得に失敗しました');
      return;
    }
    setProducts(data || []);
  };

  useEffect(() => {
    loadProducts();
  }, []);

  // product_id query -> auto select
  useEffect(() => {
    if (!filterProductId) return;
    if (products.length === 0) return;
    const p = products.find((x) => String(x.id) === String(filterProductId));
    if (p) setSelectedProduct(p);
  }, [filterProductId, products]);

  // ========== load saved plan ==========
  const loadPlan = async (product) => {
    if (!product?.id) return;

    setLoading(true);
    setError('');

    try {
      const { data, error: e } = await supabase
        .from(PLAN_TABLE)
        .select('plan_json, updated_at')
        .eq('product_id', product.id)
        .maybeSingle();

      if (e) throw e;

      if (!data?.plan_json) {
        setPlanJson(null);
        setLastSavedAt('');
        setShelfNo('');
        setError('保存された納品計画がありません。先に Labels で保存してください。');
        return;
      }

      setPlanJson(data.plan_json);
      setLastSavedAt(String(data.updated_at || data.plan_json?.updatedAt || ''));

      const s = data.plan_json?.shelfNo ?? data.plan_json?.shelf?.no ?? '';
      setShelfNo(String(s || ''));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      setError(err?.message || '保存データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedProduct?.id) return;
    loadPlan(selectedProduct);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProduct?.id]);

  // ========== save shelf ==========
  const saveInventory = async () => {
    if (!selectedProduct?.id) return;
    if (!planJson) {
      alert('保存計画がありません。先に Labels で保存してください。');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const next = {
        ...planJson,
        shelf: { ...(planJson.shelf || {}), no: String(shelfNo || '') },
        updatedAt: new Date().toISOString(),
      };

      const payload = {
        product_id: selectedProduct.id,
        plan_json: next,
        updated_at: new Date().toISOString(),
      };

      const { data, error: e } = await supabase
        .from(PLAN_TABLE)
        .upsert(payload, { onConflict: 'product_id' })
        .select('updated_at')
        .maybeSingle();

      if (e) throw e;

      setPlanJson(next);
      setLastSavedAt(String(data?.updated_at || payload.updated_at));
      alert('保存しました（棚番号）');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      setError(err?.message || '保存に失敗しました');
      alert('保存に失敗しました（Consoleを確認してください）');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h4" sx={{ fontWeight: 900, mb: 2 }}>
        在庫管理（Labels保存内容から自動計算）
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <CircularProgress size={18} />
          <Typography sx={{ opacity: 0.7 }}>処理中…</Typography>
        </Box>
      )}

      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography sx={{ fontWeight: 900, mb: 1 }}>
          ① 品番を選択（保存された納品計画を呼び出し）
        </Typography>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: 'center' }}>
          <Autocomplete
            options={products}
            value={selectedProduct}
            onChange={(_e, v) => setSelectedProduct(v)}
            getOptionLabel={(o) => (o ? `${o.product_code} ${o.name || ''}` : '')}
            renderInput={(p) => <TextField {...p} label="品番で検索（選択）" placeholder="例：99823-0058" />}
            sx={{ flex: 1 }}
          />

          <Button variant="outlined" onClick={() => selectedProduct?.id && loadPlan(selectedProduct)} disabled={!selectedProduct?.id}>
            再読込
          </Button>

          <Button
            variant="outlined"
            onClick={() => {
              if (!selectedProduct?.id) return;
              navigate(`/labels?product_id=${encodeURIComponent(String(selectedProduct.id))}`);
            }}
            disabled={!selectedProduct?.id}
          >
            Labelsへ
          </Button>
        </Stack>

        <Typography sx={{ mt: 1, opacity: 0.7, fontSize: 12 }}>
          最終保存：{lastSavedAt ? lastSavedAt : '未保存'}
        </Typography>
      </Paper>

      <Paper sx={{ p: 2, position: 'relative' }}>
        <Typography sx={{ fontWeight: 900, mb: 1 }}>
          ② 在庫（見積総数 − 納品計画合計）
        </Typography>

        {!selectedProduct?.id ? (
          <Typography sx={{ opacity: 0.75 }}>品番を選択してください。</Typography>
        ) : !planJson ? (
          <Typography sx={{ opacity: 0.75 }}>
            保存計画がありません。先に Labels で「保存」してください。
          </Typography>
        ) : (
          <>
            {isDone && <DoneStamp />}

            <Typography sx={{ fontSize: 14, opacity: 0.9 }}>
              <b>品番：</b>{meta.productCode || selectedProduct.product_code}　／　<b>商品名：</b>{meta.productName || selectedProduct.name}
            </Typography>
            <Typography sx={{ mt: 0.5, fontSize: 14, opacity: 0.9 }}>
              <b>納品工場：</b>{meta.factoryCode || '-'}　／　<b>ロット：</b>{lotQty || '-'}
            </Typography>

            <Divider sx={{ my: 2 }} />

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' }, gap: 2 }}>
              <Box>
                <Typography sx={{ opacity: 0.7, fontSize: 12 }}>見積総数（保存値）</Typography>
                <Typography sx={{ fontSize: 28, fontWeight: 900 }}>{totalQty}</Typography>
              </Box>

              <Box>
                <Typography sx={{ opacity: 0.7, fontSize: 12 }}>納品計画合計（Labels保存）</Typography>
                <Typography sx={{ fontSize: 28, fontWeight: 900 }}>{plannedSum}</Typography>
              </Box>

              <Box>
                <Typography sx={{ opacity: 0.7, fontSize: 12 }}>在庫数（未割当）</Typography>
                <Typography sx={{ fontSize: 28, fontWeight: 900 }}>{stockQty}</Typography>
              </Box>
            </Box>

            <Divider sx={{ my: 2 }} />

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: 'center' }}>
              <TextField
                label="棚番号（自由入力）"
                value={shelfNo}
                onChange={(e) => setShelfNo(e.target.value)}
                placeholder="例：A-03-2"
                sx={{ flex: 1 }}
              />
              <Button variant="contained" onClick={saveInventory} disabled={loading}>
                棚番号を保存
              </Button>
            </Stack>

            <Typography sx={{ mt: 1, opacity: 0.65, fontSize: 12 }}>
              ※ 在庫数は Labels の「納品計画合計」から自動計算されます（ここでは直接編集しません）。
            </Typography>

            <Divider sx={{ my: 2 }} />

            <Typography sx={{ fontWeight: 900, mb: 1 }}>③ 納品計画（参照）</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 60 }}>No</TableCell>
                  <TableCell>納品日</TableCell>
                  <TableCell sx={{ width: 140, textAlign: 'right' }}>納品数量</TableCell>
                  <TableCell sx={{ width: 240 }}>包数</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {lines.map((r, idx) => (
                  <TableRow key={r.id} hover>
                    <TableCell sx={{ opacity: 0.8 }}>{idx + 1}</TableCell>
                    <TableCell>{r.date}</TableCell>
                    <TableCell sx={{ textAlign: 'right' }}>{toInt(r.qty)}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace' }}>
                      {packText(r.qty, lotQty)}
                    </TableCell>
                  </TableRow>
                ))}
                {lines.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} sx={{ opacity: 0.7 }}>
                      納品計画が空です（Labelsで編集・保存してください）
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </>
        )}
      </Paper>
    </Box>
  );
}
