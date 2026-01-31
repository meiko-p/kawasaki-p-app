import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  TextField,
  Typography,
} from '@mui/material';

/** =========================
 *  Utils（Labelsと同等）
 *  ========================= */

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

function toFactoryCodeA(deliveryFactory) {
  const s = String(deliveryFactory ?? '').trim();
  if (!s) return '';
  const digits = s.replace(/[^\d]/g, '');
  if (!digits) return s;
  return `${Number(digits)}A`;
}

function normalizeDeliverySchedule(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((r, idx) => {
      const date =
        r?.date ??
        r?.delivery_date ??
        r?.deliveryDate ??
        r?.deliver_date ??
        '';

      const qty = safeNum(
        r?.qty ??
          r?.quantity ??
          r?.count ??
          r?.amount ??
          r?.delivery_qty ??
          r?.delivery_quantity ??
          0,
      );

      if (!date && !qty) return null;
      return {
        id: `sch-${idx}`,
        date: String(date ?? ''),
        qty,
      };
    })
    .filter(Boolean);
}

function pickTotalQtyFromEstimate(estRow, fallbackSum) {
  const candidates = [
    estRow?.total_qty,
    estRow?.total_quantity,
    estRow?.estimate_qty,
    estRow?.estimate_quantity,
    estRow?.qty,
    estRow?.quantity,
    estRow?.order_qty,
    estRow?.order_quantity,
    estRow?.delivery_total,
  ];

  for (const c of candidates) {
    const n = safeNum(c);
    if (n > 0) return n;
  }
  return fallbackSum;
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

/** =========================
 *  Page
 *  ========================= */

export default function Inventory() {
  const [params] = useSearchParams();
  const filterProductId = params.get('product_id') || '';

  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [result, setResult] = useState({
    factoryCode: '',
    totalQty: 0,
    scheduleSum: 0,
    remainQty: 0,
    estimateId: null,
    estimateCreatedAt: null,
  });

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // クエリ product_id があれば自動選択
  useEffect(() => {
    if (!filterProductId) return;
    if (products.length === 0) return;
    const p = products.find((x) => String(x.id) === String(filterProductId));
    if (p) setSelectedProduct(p);
  }, [filterProductId, products]);

  // ========== load estimate ==========
  const loadForProduct = async (product) => {
    if (!product?.id) return;

    setLoading(true);
    setError('');

    try {
      const { data: est, error: estErr } = await supabase
        .from('estimates')
        .select('*')
        .eq('product_id', product.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (estErr) throw estErr;

      if (!est) {
        setResult({
          factoryCode: '',
          totalQty: 0,
          scheduleSum: 0,
          remainQty: 0,
          estimateId: null,
          estimateCreatedAt: null,
        });
        setError('この品番の見積データ（estimates）が見つかりませんでした。');
        return;
      }

      const schedule = normalizeDeliverySchedule(est.delivery_schedule);
      const scheduleSum = schedule.reduce((s, r) => s + toInt(r.qty), 0);
      const totalQty = pickTotalQtyFromEstimate(est, scheduleSum);
      const remainQty = totalQty - scheduleSum;

      setResult({
        factoryCode: toFactoryCodeA(est.delivery_factory),
        totalQty: toInt(totalQty),
        scheduleSum: toInt(scheduleSum),
        remainQty: Number.isFinite(remainQty) ? remainQty : 0,
        estimateId: est.id || null,
        estimateCreatedAt: est.created_at || null,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      setError(err?.message || '在庫情報の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedProduct?.id) return;
    loadForProduct(selectedProduct);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProduct?.id]);

  const isDone = useMemo(() => {
    // 「納品総数 − 納品予定合計」が 0 以下なら「済」扱い
    return result.totalQty > 0 && result.remainQty <= 0;
  }, [result.totalQty, result.remainQty]);

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h4" sx={{ fontWeight: 900, mb: 2 }}>
        在庫管理（未割当＝見積総数 − 納品予定合計）
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
          ① 品番を選択
        </Typography>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: 'center' }}>
          <Autocomplete
            options={products}
            value={selectedProduct}
            onChange={(_e, v) => setSelectedProduct(v)}
            getOptionLabel={(o) => (o ? `${o.product_code} ${o.name || ''}` : '')}
            renderInput={(p) => <TextField {...p} label="品番で検索（選択）" placeholder="例：99998-0001" />}
            sx={{ flex: 1 }}
          />

          <Button variant="outlined" onClick={() => selectedProduct?.id && loadForProduct(selectedProduct)}>
            再読み込み
          </Button>
        </Stack>
      </Paper>

      <Paper sx={{ p: 2, position: 'relative' }}>
        <Typography sx={{ fontWeight: 900, mb: 1 }}>
          ② 在庫（未割当）表示
        </Typography>

        {!selectedProduct?.id ? (
          <Typography sx={{ opacity: 0.75 }}>品番を選択してください。</Typography>
        ) : (
          <>
            {isDone && <DoneStamp />}

            <Typography sx={{ fontSize: 14, opacity: 0.85 }}>
              <b>品番：</b>{selectedProduct.product_code}　／　<b>商品名：</b>{selectedProduct.name}
            </Typography>
            <Typography sx={{ mt: 0.5, fontSize: 14, opacity: 0.85 }}>
              <b>納品工場：</b>{result.factoryCode || '-'}
            </Typography>

            <Divider sx={{ my: 2 }} />

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' },
                gap: 2,
              }}
            >
              <Box>
                <Typography sx={{ opacity: 0.7, fontSize: 12 }}>納品総数（見積）</Typography>
                <Typography sx={{ fontSize: 28, fontWeight: 900 }}>
                  {result.totalQty}
                </Typography>
              </Box>

              <Box>
                <Typography sx={{ opacity: 0.7, fontSize: 12 }}>納品予定合計</Typography>
                <Typography sx={{ fontSize: 28, fontWeight: 900 }}>
                  {result.scheduleSum}
                </Typography>
              </Box>

              <Box>
                <Typography sx={{ opacity: 0.7, fontSize: 12 }}>未割当（在庫候補）</Typography>
                <Typography sx={{ fontSize: 28, fontWeight: 900 }}>
                  {result.remainQty}
                </Typography>
              </Box>
            </Box>

            {result.remainQty < 0 && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                納品予定合計が見積総数を超えています。見積の数量または納品予定を確認してください。
              </Alert>
            )}

            <Typography sx={{ mt: 2, opacity: 0.6, fontSize: 12 }}>
              ※ 現段階は「見積総数 − 納品予定合計」で在庫（未割当）を表示するシンプル設計です。
              未割当が 0 になったら自動で「済」スタンプを表示します。
            </Typography>
          </>
        )}
      </Paper>
    </Box>
  );
}
