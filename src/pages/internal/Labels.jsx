import React, { useEffect, useMemo, useRef, useState } from 'react';
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

import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

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

/** "2026-01-19" / "2026/01/19" / "2026-01-19T.." -> "1月19日" */
function formatMonthDay(dateStr) {
  const s0 = String(dateStr ?? '').trim();
  if (!s0) return '';
  const s = s0.includes('T') ? s0.split('T')[0] : s0;

  const m1 = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (m1) return `${Number(m1[2])}月${Number(m1[3])}日`;

  const m2 = s.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (m2) return `${Number(m2[1])}月${Number(m2[2])}日`;

  return s0;
}

/** delivery_factory -> "76A" */
function toFactoryCodeA(deliveryFactory) {
  const s = String(deliveryFactory ?? '').trim();
  if (!s) return '';
  const digits = s.replace(/[^\d]/g, '');
  if (!digits) return s;
  return `${Number(digits)}A`;
}

/** 見積の総数候補（カラム揺れ対応） */
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

/** delivery_schedule を [{dateLabel, qty}] に正規化（キー揺れ吸収） */
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

      const dateLabel = formatMonthDay(date);
      if (!dateLabel && !qty) return null;

      return {
        id: `sch-${idx}`,
        dateLabel,
        qty: toInt(qty),
      };
    })
    .filter(Boolean);
}

/**
 * 包数表示（要求仕様）
 * - 100, lot=5 -> "5×20包"
 * - 42,  lot=5 -> "5×9包（最終包2冊）" ※ 9包は ceil(42/5)
 */
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

/** DOMキャプチャしてPDF化（長い場合は複数ページ） */
async function buildPdfBlobFromElement(el) {
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }

  const canvas = await html2canvas(el, {
    scale: 2,
    backgroundColor: '#ffffff',
    useCORS: true,
    scrollY: 0,
    windowWidth: el.scrollWidth,
    windowHeight: el.scrollHeight,
  });

  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const pdfW = pdf.internal.pageSize.getWidth();
  const pdfH = pdf.internal.pageSize.getHeight();
  const margin = 10;

  const imgW = pdfW - margin * 2;
  const imgH = (canvas.height * imgW) / canvas.width;

  let y = margin;
  pdf.addImage(imgData, 'PNG', margin, y, imgW, imgH, undefined, 'FAST');

  let heightLeft = imgH - (pdfH - margin * 2);
  while (heightLeft > 0) {
    pdf.addPage();
    y = margin - (imgH - heightLeft);
    pdf.addImage(imgData, 'PNG', margin, y, imgW, imgH, undefined, 'FAST');
    heightLeft -= (pdfH - margin * 2);
  }

  return pdf.output('blob');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function normalizeLinesForSave(lines) {
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

export default function Labels() {
  const [params] = useSearchParams();
  const filterProductId = params.get('product_id') || '';
  const navigate = useNavigate();

  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 見積/梱包の「参照情報」（再計算用）
  const [estimateRow, setEstimateRow] = useState(null);
  const [scheduleNorm, setScheduleNorm] = useState([]);
  const [lotFromPackage, setLotFromPackage] = useState('');

  // 保存される「計画」(編集可能)
  const [form, setForm] = useState({
    productCode: '',
    productName: '',
    factoryCode: '',
    totalQty: '',
    lotQty: '',
  });
  const [lines, setLines] = useState([]);
  const [shelfNo, setShelfNo] = useState(''); // Inventory側で編集するが、Labels側でも保持して上書きしないために保持
  const [lastSavedAt, setLastSavedAt] = useState('');

  const previewRef = useRef(null);

  const scheduleSum = useMemo(() => scheduleNorm.reduce((s, r) => s + toInt(r.qty), 0), [scheduleNorm]);
  const totalQtyNum = useMemo(() => toInt(form.totalQty), [form.totalQty]);
  const lotQtyNum = useMemo(() => toInt(form.lotQty), [form.lotQty]);

  const plannedSum = useMemo(() => {
    return lines.reduce((s, r) => s + toInt(r.qty), 0);
  }, [lines]);

  // ★在庫候補は「Labelsで入力した合計」を引く（要求仕様）
  const remainQty = useMemo(() => {
    const r = totalQtyNum - plannedSum;
    return Number.isFinite(r) ? r : 0;
  }, [totalQtyNum, plannedSum]);

  const totalPackText = useMemo(() => {
    if (totalQtyNum <= 0 || lotQtyNum <= 0) return '-';
    return packText(totalQtyNum, lotQtyNum);
  }, [totalQtyNum, lotQtyNum]);

  const canSave = useMemo(() => {
    return !!selectedProduct?.id;
  }, [selectedProduct?.id]);

  const canPdf = useMemo(() => {
    return !!selectedProduct?.id && lines.length > 0;
  }, [selectedProduct?.id, lines.length]);

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

  // ========== load estimate + package lot + saved plan ==========
  const loadAllForProduct = async (product) => {
    if (!product?.id) return;

    setLoading(true);
    setError('');

    try {
      // 並列取得
      const [estRes, pkgRes, planRes] = await Promise.all([
        supabase
          .from('estimates')
          .select('*')
          .eq('product_id', product.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('packages')
          .select('id, lot_qty, created_at')
          .eq('product_id', product.id)
          .not('lot_qty', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from(PLAN_TABLE)
          .select('product_id, plan_json, updated_at')
          .eq('product_id', product.id)
          .maybeSingle(),
      ]);

      if (estRes.error) throw estRes.error;
      if (pkgRes.error) {
        // eslint-disable-next-line no-console
        console.warn(pkgRes.error);
      }
      if (planRes.error) {
        // テーブル未作成/権限不足など
        throw planRes.error;
      }

      const est = estRes.data || null;
      const pkg = pkgRes.data || null;
      const savedRow = planRes.data || null;

      setEstimateRow(est);

      // 見積の基準データ（再生成用）
      const baseSchedule = normalizeDeliverySchedule(est?.delivery_schedule);
      setScheduleNorm(baseSchedule);

      const baseFactoryCode = toFactoryCodeA(est?.delivery_factory);
      const baseTotal = pickTotalQtyFromEstimate(est, baseSchedule.reduce((s, r) => s + toInt(r.qty), 0));
      const lotAuto = pkg?.lot_qty ? String(pkg.lot_qty) : '';
      setLotFromPackage(lotAuto);

      // 保存計画があるなら優先して読み込み
      const saved = savedRow?.plan_json;
      const hasSaved = saved && typeof saved === 'object' && Array.isArray(saved.lines) && saved.lines.length > 0;

      if (hasSaved) {
        const meta = saved.meta || {};
        const savedLines = normalizeLinesForSave(saved.lines);

        setForm({
          productCode: String(meta.productCode ?? product.product_code ?? ''),
          productName: String(meta.productName ?? product.name ?? ''),
          factoryCode: String(meta.factoryCode ?? baseFactoryCode ?? ''),
          totalQty: meta.totalQty != null ? String(meta.totalQty) : (baseTotal ? String(baseTotal) : ''),
          lotQty: meta.lotQty != null ? String(meta.lotQty) : (lotAuto || ''),
        });

        setLines(
          savedLines.map((r) => ({
            id: r.id,
            date: String(r.date ?? ''),
            qty: toInt(r.qty),
          })),
        );

        // shelfNoはInventory側で使うが、Labels保存で消えないよう保持
        const shelf =
          saved.shelfNo ??
          saved?.shelf?.no ??
          '';
        setShelfNo(String(shelf || ''));

        setLastSavedAt(String(savedRow?.updated_at || saved.updatedAt || ''));

      } else {
        // 保存が無い場合：見積を元に「1日1行」で初期化
        setForm({
          productCode: product.product_code || '',
          productName: product.name || '',
          factoryCode: baseFactoryCode || '',
          totalQty: baseTotal ? String(baseTotal) : '',
          lotQty: lotAuto || '',
        });

        const initLines =
          baseSchedule.length > 0
            ? baseSchedule.map((r) => ({
                id: `line-${Date.now()}-${Math.random()}`,
                date: r.dateLabel,
                qty: toInt(r.qty),
              }))
            : [{ id: `line-${Date.now()}`, date: '', qty: 0 }];

        setLines(initLines);
        setShelfNo('');
        setLastSavedAt('');
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      setError(err?.message || '見積/梱包/保存データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedProduct?.id) return;
    loadAllForProduct(selectedProduct);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProduct?.id]);

  // ========== edit helpers ==========
  const setFormField = (k, v) => setForm((prev) => ({ ...prev, [k]: v }));

  const updateLine = (id, patch) => {
    setLines((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const addLine = () => {
    setLines((prev) => [...prev, { id: `line-${Date.now()}`, date: '', qty: 0 }]);
  };

  const removeLine = (id) => {
    setLines((prev) => prev.filter((r) => r.id !== id));
  };

  // ★見積から「1日1行」で再生成（ロットで分割しない）
  const regenerateFromEstimate = () => {
    if (!scheduleNorm.length) {
      alert('見積に納品予定がありません（delivery_schedule）');
      return;
    }
    if (!window.confirm('見積の納品予定を元に「1日1行」で再生成します。手動編集した行は上書きされます。よろしいですか？')) {
      return;
    }
    setLines(
      scheduleNorm.map((r) => ({
        id: `line-${Date.now()}-${Math.random()}`,
        date: r.dateLabel,
        qty: toInt(r.qty),
      })),
    );
  };

  // ========== save / load ==========
  const buildPlanJson = () => {
    const cleanLines = normalizeLinesForSave(lines);

    return {
      meta: {
        productCode: String(form.productCode ?? ''),
        productName: String(form.productName ?? ''),
        factoryCode: String(form.factoryCode ?? ''),
        totalQty: toInt(form.totalQty),
        lotQty: toInt(form.lotQty),
      },
      lines: cleanLines,
      shelf: { no: String(shelfNo ?? '') }, // Inventoryで編集する
      source: {
        estimateId: estimateRow?.id ?? null,
        lotFromPackage: lotFromPackage || null,
        scheduleSum: scheduleSum,
      },
      updatedAt: new Date().toISOString(),
    };
  };

  const savePlan = async () => {
    if (!canSave) return;

    setLoading(true);
    setError('');

    try {
      const payload = {
        product_id: selectedProduct.id,
        plan_json: buildPlanJson(),
        updated_at: new Date().toISOString(),
      };

      const { data, error: upErr } = await supabase
        .from(PLAN_TABLE)
        .upsert(payload, { onConflict: 'product_id' })
        .select('updated_at')
        .maybeSingle();

      if (upErr) throw upErr;

      setLastSavedAt(String(data?.updated_at || payload.updated_at));
      alert('保存しました');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      setError(err?.message || '保存に失敗しました');
      alert('保存に失敗しました（Consoleを確認してください）');
    } finally {
      setLoading(false);
    }
  };

  const saveAndPdf = async () => {
    await savePlan();
    // 保存が失敗してもPDFは出せるようにする（エラーがあれば表示されたまま）
    await downloadPdf();
  };

  // ========== PDF ==========
  const downloadPdf = async () => {
    if (!canPdf) {
      alert('納品行がありません');
      return;
    }
    if (!previewRef.current) {
      alert('プレビューDOMが見つかりません');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const blob = await buildPdfBlobFromElement(previewRef.current);
      const safeCode = (form.productCode || 'labels').replace(/[^a-zA-Z0-9-_]+/g, '_');
      downloadBlob(blob, `delivery_plan_${safeCode}.pdf`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      setError(err?.message || 'PDF生成に失敗しました');
      alert('PDF生成に失敗しました（Consoleを確認してください）');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h4" sx={{ fontWeight: 900, mb: 2 }}>
        納品予定（1日1行・包数表示）＋保存＋PDF
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

      {/* ① 品番選択 */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography sx={{ fontWeight: 900, mb: 1 }}>
          ① 品番を選択（見積＋梱包＋保存データを読み込み）
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

          <Button variant="outlined" onClick={() => selectedProduct?.id && loadAllForProduct(selectedProduct)} disabled={!selectedProduct?.id}>
            再読込
          </Button>

          <Button
            variant="outlined"
            onClick={() => {
              if (!selectedProduct?.id) return;
              navigate(`/inventory?product_id=${encodeURIComponent(String(selectedProduct.id))}`);
            }}
            disabled={!selectedProduct?.id}
          >
            在庫管理へ
          </Button>
        </Stack>

        <Typography sx={{ mt: 1, opacity: 0.7, fontSize: 12 }}>
          最終保存：{lastSavedAt ? lastSavedAt : '未保存'}
        </Typography>
      </Paper>

      {/* ② 編集フォーム */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography sx={{ fontWeight: 900, mb: 1 }}>
          ② PDF出力内容（全て手動修正OK）
        </Typography>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' }, gap: 1 }}>
          <TextField label="品番" value={form.productCode} onChange={(e) => setFormField('productCode', e.target.value)} />
          <TextField label="商品名" value={form.productName} onChange={(e) => setFormField('productName', e.target.value)} />
          <TextField label="納品工場（例：76A）" value={form.factoryCode} onChange={(e) => setFormField('factoryCode', e.target.value)} />

          <TextField label="納品総数（見積/伝票の総数）" value={form.totalQty} onChange={(e) => setFormField('totalQty', e.target.value)} placeholder="例：500" />
          <TextField
            label="1梱包に入る数量（ロット）"
            value={form.lotQty}
            onChange={(e) => setFormField('lotQty', e.target.value)}
            placeholder="例：5"
            helperText={lotFromPackage ? `梱包登録から自動取得：${lotFromPackage}` : '梱包登録が無い場合は手入力'}
          />
          <TextField label="（参考）見積の納品予定合計" value={String(scheduleSum)} disabled />
        </Box>

        <Box sx={{ mt: 1 }}>
          <Typography sx={{ opacity: 0.85, fontSize: 13 }}>
            総包数（目安）：{totalPackText}
          </Typography>
          <Typography sx={{ opacity: 0.85, fontSize: 13 }}>
            在庫候補（Inventory連動）＝ 見積総数（{totalQtyNum}） − 納品計画合計（{plannedSum}）＝ <b>{remainQty}</b>
          </Typography>
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* ③ 納品行：1日1行 + 包数表示 */}
        <Typography sx={{ fontWeight: 900, mb: 1 }}>
          ③ 納品日・納品数量（1日1行／包数を自動表示／ここも編集OK）
        </Typography>

        <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap' }}>
          <Button variant="outlined" onClick={regenerateFromEstimate} disabled={!scheduleNorm.length}>
            見積から再生成（1日1行）
          </Button>
          <Button variant="outlined" onClick={addLine}>
            行を追加
          </Button>
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ opacity: 0.75, fontSize: 12 }}>
            ※ 納品計画合計（編集後）：{plannedSum}
          </Typography>
        </Stack>

        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 60 }}>No</TableCell>
              <TableCell>納品日</TableCell>
              <TableCell sx={{ width: 200 }}>納品数量</TableCell>
              <TableCell sx={{ width: 260 }}>包数（表示）</TableCell>
              <TableCell sx={{ width: 120 }} align="right">
                操作
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.map((r, idx) => (
              <TableRow key={r.id} hover>
                <TableCell sx={{ opacity: 0.8 }}>{idx + 1}</TableCell>

                <TableCell>
                  <TextField
                    variant="standard"
                    value={r.date}
                    onChange={(e) => updateLine(r.id, { date: e.target.value })}
                    placeholder="例：1月19日"
                    fullWidth
                  />
                </TableCell>

                <TableCell>
                  <TextField
                    variant="standard"
                    value={String(r.qty ?? '')}
                    onChange={(e) => updateLine(r.id, { qty: e.target.value })}
                    placeholder="例：100"
                    fullWidth
                    inputProps={{ style: { textAlign: 'right' } }}
                  />
                </TableCell>

                <TableCell>
                  <Typography sx={{ fontFamily: 'monospace', fontSize: 13 }}>
                    {packText(r.qty, form.lotQty)}
                  </Typography>
                </TableCell>

                <TableCell align="right">
                  <Button size="small" color="error" variant="outlined" onClick={() => removeLine(r.id)}>
                    削除
                  </Button>
                </TableCell>
              </TableRow>
            ))}

            {lines.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} sx={{ opacity: 0.7 }}>
                  納品行がありません。「行を追加」または「見積から再生成」を押してください。
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <Divider sx={{ my: 2 }} />

        <Stack direction="row" spacing={1} flexWrap="wrap">
          <Button variant="contained" onClick={savePlan} disabled={!canSave || loading}>
            保存
          </Button>
          <Button variant="contained" onClick={saveAndPdf} disabled={!canPdf || loading}>
            保存してPDF出力
          </Button>
          <Button variant="outlined" onClick={downloadPdf} disabled={!canPdf || loading}>
            PDF出力のみ
          </Button>
        </Stack>

        <Typography sx={{ mt: 1, opacity: 0.6, fontSize: 12 }}>
          ※ 保存内容は「{PLAN_TABLE}」に保持され、Inventory.jsx が同じ保存内容から在庫を自動計算します。
        </Typography>
      </Paper>

      {/* ④ PDFプレビュー（ここがPDFになる） */}
      <Paper sx={{ p: 2 }}>
        <Typography sx={{ fontWeight: 900, mb: 1 }}>
          ④ PDFプレビュー（ここがそのままPDFになります）
        </Typography>

        {!selectedProduct?.id ? (
          <Typography sx={{ opacity: 0.75 }}>品番を選択してください。</Typography>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Box
              ref={previewRef}
              sx={{
                width: 794, // A4相当
                background: '#fff',
                color: '#111',
                p: 3,
                border: '1px solid rgba(0,0,0,0.15)',
                borderRadius: 1,
                fontFamily: 'sans-serif',
              }}
            >
              <Typography sx={{ fontSize: 18, fontWeight: 900, mb: 1 }}>
                納品計画一覧（1日1行・包数表示）
              </Typography>

              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 2, fontSize: 12 }}>
                <Box>
                  <div><b>品番：</b>{form.productCode}</div>
                  <div><b>商品名：</b>{form.productName}</div>
                  <div><b>納品工場：</b>{form.factoryCode}</div>
                </Box>
                <Box>
                  <div><b>納品総数：</b>{totalQtyNum}</div>
                  <div><b>ロット：</b>{lotQtyNum}</div>
                  <div><b>総包数（目安）：</b>{totalPackText}</div>
                  <div><b>在庫候補：</b>{remainQty}</div>
                </Box>
              </Box>

              <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <Box component="thead">
                  <Box component="tr">
                    <Box component="th" sx={{ border: '1px solid #333', p: 1, width: 60, textAlign: 'center' }}>
                      No
                    </Box>
                    <Box component="th" sx={{ border: '1px solid #333', p: 1, textAlign: 'center' }}>
                      納品日
                    </Box>
                    <Box component="th" sx={{ border: '1px solid #333', p: 1, width: 120, textAlign: 'center' }}>
                      納品数量
                    </Box>
                    <Box component="th" sx={{ border: '1px solid #333', p: 1, width: 220, textAlign: 'center' }}>
                      包数（ロット×包数）
                    </Box>
                  </Box>
                </Box>

                <Box component="tbody">
                  {normalizeLinesForSave(lines).map((r, idx) => (
                    <Box component="tr" key={`pv-${r.id}`}>
                      <Box component="td" sx={{ border: '1px solid #333', p: 1, textAlign: 'center' }}>
                        {idx + 1}
                      </Box>
                      <Box component="td" sx={{ border: '1px solid #333', p: 1 }}>
                        {String(r.date ?? '')}
                      </Box>
                      <Box component="td" sx={{ border: '1px solid #333', p: 1, textAlign: 'right' }}>
                        {toInt(r.qty)}
                      </Box>
                      <Box component="td" sx={{ border: '1px solid #333', p: 1, fontFamily: 'monospace' }}>
                        {packText(r.qty, form.lotQty)}
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Box>

              <Typography sx={{ mt: 2, fontSize: 11, opacity: 0.8 }}>
                ※ 例：42冊・ロット5 → {`5×9包（最終包2冊）`} のように「包数」をコンパクトに表示します。
              </Typography>
            </Box>
          </Box>
        )}
      </Paper>
    </Box>
  );
}
