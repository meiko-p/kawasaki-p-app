import React, { useEffect, useMemo, useRef, useState } from 'react';
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

/** =========================
 *  Utils
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

/** "2026-01-30" / "2026/01/30" / "2026-01-30T..." -> "1月30日" */
function formatMonthDay(dateStr) {
  const s0 = String(dateStr ?? '').trim();
  if (!s0) return '';
  const s = s0.includes('T') ? s0.split('T')[0] : s0;

  // YYYY-MM-DD or YYYY/MM/DD
  const m1 = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (m1) return `${Number(m1[2])}月${Number(m1[3])}日`;

  // MM-DD or MM/DD
  const m2 = s.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (m2) return `${Number(m2[1])}月${Number(m2[2])}日`;

  return s0; // fallback（そのまま）
}

/** delivery_factory -> "76A"（"76工場"でも "76" でもOK） */
function toFactoryCodeA(deliveryFactory) {
  const s = String(deliveryFactory ?? '').trim();
  if (!s) return '';
  const digits = s.replace(/[^\d]/g, '');
  if (!digits) return s;
  // 例示が "76A" なので先頭ゼロは落とす（076→76）
  return `${Number(digits)}A`;
}

/** 見積の「総数」候補を柔軟に拾う（環境によりカラム名が違う前提で対応） */
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
  return fallbackSum; // 最後の手段：納品予定合計を総数扱い
}

/** delivery_schedule を [{date, qty}] に正規化（キー揺れ吸収） */
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
        dateRaw: String(date ?? ''),
        dateLabel,
        qty,
      };
    })
    .filter(Boolean);
}

/** ロット分割：qty > lot の場合、lot単位で複数行に展開 */
function expandScheduleToLines(scheduleNormalized, lotQty) {
  const lot = toInt(lotQty);
  const out = [];
  let i = 0;

  for (const item of scheduleNormalized) {
    const qty = toInt(item.qty);
    if (qty <= 0) continue;

    // ロット未設定なら分割せずそのまま1行
    if (lot <= 0 || qty <= lot) {
      out.push({
        id: `line-${i++}`,
        date: item.dateLabel,
        qty,
      });
      continue;
    }

    const full = Math.floor(qty / lot);
    const rem = qty % lot;

    for (let k = 0; k < full; k++) {
      out.push({
        id: `line-${i++}`,
        date: k === 0 ? item.dateLabel : '', // 2行目以降は日付を空欄（例に合わせる）
        qty: lot,
      });
    }
    if (rem > 0) {
      out.push({
        id: `line-${i++}`,
        date: full === 0 ? item.dateLabel : '',
        qty: rem,
      });
    }
  }

  return out;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * DOMをキャプチャしてPDF生成（日本語も確実）
 * 長い場合は複数ページに分割してPDF化します。
 */
async function buildPdfBlobFromElement(el) {
  // 入力フォーカスを外す（カーソルが写り込むのを抑止）
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

  const pdfW = pdf.internal.pageSize.getWidth();  // 210
  const pdfH = pdf.internal.pageSize.getHeight(); // 297
  const margin = 10;

  const imgW = pdfW - margin * 2;
  const imgH = (canvas.height * imgW) / canvas.width;

  let positionY = margin;
  pdf.addImage(imgData, 'PNG', margin, positionY, imgW, imgH, undefined, 'FAST');

  // 複数ページ化
  let heightLeft = imgH - (pdfH - margin * 2);
  while (heightLeft > 0) {
    pdf.addPage();
    positionY = margin - (imgH - heightLeft);
    pdf.addImage(imgData, 'PNG', margin, positionY, imgW, imgH, undefined, 'FAST');
    heightLeft -= (pdfH - margin * 2);
  }

  return pdf.output('blob');
}

/** =========================
 *  Page
 *  ========================= */

export default function Labels() {
  const [params] = useSearchParams();
  const filterProductId = params.get('product_id') || '';

  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 見積・梱包データ（元）
  const [estimateRow, setEstimateRow] = useState(null);
  const [scheduleNorm, setScheduleNorm] = useState([]); // 見積の納品予定（正規化）
  const [lotFromPackage, setLotFromPackage] = useState(''); // 梱包ロット（自動）

  // 編集可能（PDF出力に反映）
  const [form, setForm] = useState({
    productCode: '',
    productName: '',
    factoryCode: '',
    totalQty: '', // 見積総数
    lotQty: '',   // 1梱包ロット
  });

  const [lines, setLines] = useState([]); // 分割後（編集可）

  const previewRef = useRef(null);

  const scheduleSum = useMemo(() => {
    return scheduleNorm.reduce((s, r) => s + toInt(r.qty), 0);
  }, [scheduleNorm]);

  const totalQtyNum = useMemo(() => toInt(form.totalQty), [form.totalQty]);

  const remainQty = useMemo(() => {
    const r = totalQtyNum - scheduleSum;
    return Number.isFinite(r) ? r : 0;
  }, [totalQtyNum, scheduleSum]);

  const linesSum = useMemo(() => {
    return lines.reduce((s, r) => s + toInt(r.qty), 0);
  }, [lines]);

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

  // ========== load estimate + latest package(lot) ==========
  const loadEstimateAndPackage = async (product) => {
    if (!product?.id) return;

    setLoading(true);
    setError('');

    try {
      // 1) 見積（最新を採用：必要なら ascending:true に変えて「最初」を採用可能）
      const { data: est, error: estErr } = await supabase
        .from('estimates')
        .select('*')
        .eq('product_id', product.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (estErr) throw estErr;

      // 見積が無い場合
      if (!est) {
        setEstimateRow(null);
        setScheduleNorm([]);
        setLotFromPackage('');
        setForm((prev) => ({
          ...prev,
          productCode: product.product_code || '',
          productName: product.name || '',
          factoryCode: '',
          totalQty: '',
          lotQty: '',
        }));
        setLines([]);
        setError('この品番の見積データ（estimates）が見つかりませんでした。');
        return;
      }

      // 2) 梱包（packages）から最新の lot_qty を取得
      const { data: pkg, error: pkgErr } = await supabase
        .from('packages')
        .select('id, lot_qty, created_at')
        .eq('product_id', product.id)
        .not('lot_qty', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (pkgErr) {
        // eslint-disable-next-line no-console
        console.error(pkgErr);
      }

      const schedule = normalizeDeliverySchedule(est.delivery_schedule);
      const sum = schedule.reduce((s, r) => s + toInt(r.qty), 0);
      const totalQty = pickTotalQtyFromEstimate(est, sum);

      const factoryCode = toFactoryCodeA(est.delivery_factory);

      const lotAuto = pkg?.lot_qty ? String(pkg.lot_qty) : '';
      const lotUse = lotAuto || ''; // まず自動値（無ければ空）

      setEstimateRow(est);
      setScheduleNorm(schedule);
      setLotFromPackage(lotAuto);

      // 編集フォームへ反映（編集可）
      setForm({
        productCode: product.product_code || '',
        productName: product.name || '',
        factoryCode: factoryCode || '',
        totalQty: totalQty ? String(totalQty) : '',
        lotQty: lotUse,
      });

      // 分割行を生成（編集可）
      const initialLines = expandScheduleToLines(schedule, lotUse);
      setLines(initialLines);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      setError(err?.message || '見積/梱包データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedProduct?.id) return;
    loadEstimateAndPackage(selectedProduct);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProduct?.id]);

  // ========== edit helpers ==========
  const setFormField = (k, v) => setForm((prev) => ({ ...prev, [k]: v }));

  const updateLine = (id, patch) => {
    setLines((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      { id: `line-${Date.now()}`, date: '', qty: 0 },
    ]);
  };

  const removeLine = (id) => {
    setLines((prev) => prev.filter((r) => r.id !== id));
  };

  const regenerateByLot = () => {
    if (!window.confirm('見積の納品予定を元に、現在のロットで再分割します。手動編集した行はリセットされます。よろしいですか？')) {
      return;
    }
    const next = expandScheduleToLines(scheduleNorm, form.lotQty);
    setLines(next);
  };

  // ========== PDF ==========
  const downloadPdf = async () => {
    if (!previewRef.current) {
      alert('プレビューDOMが見つかりません');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const blob = await buildPdfBlobFromElement(previewRef.current);
      const safeCode = (form.productCode || 'labels').replace(/[^a-zA-Z0-9-_]+/g, '_');
      downloadBlob(blob, `delivery_list_${safeCode}.pdf`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      setError(err?.message || 'PDF生成に失敗しました');
      alert('PDF生成に失敗しました（Consoleを確認してください）');
    } finally {
      setLoading(false);
    }
  };

  const canExport = useMemo(() => {
    return !!selectedProduct?.id && lines.length > 0;
  }, [selectedProduct?.id, lines.length]);

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h4" sx={{ fontWeight: 900, mb: 2 }}>
        納品予定一覧（ロット分割）PDF出力
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
          ① 品番を選択（見積＋梱包から自動反映）
        </Typography>

        <Autocomplete
          options={products}
          value={selectedProduct}
          onChange={(_e, v) => setSelectedProduct(v)}
          getOptionLabel={(o) => (o ? `${o.product_code} ${o.name || ''}` : '')}
          renderInput={(p) => <TextField {...p} label="品番で検索（選択）" placeholder="例：99998-0001" />}
        />

        <Typography sx={{ mt: 1, opacity: 0.7, fontSize: 12 }}>
          ※ 梱包登録（packages）にロットが無い場合は、下の「1梱包に入る数量（ロット）」へ手入力してください。
        </Typography>
      </Paper>

      {/* ② 編集フォーム */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography sx={{ fontWeight: 900, mb: 1 }}>
          ② PDF出力内容（全て手動修正OK）
        </Typography>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' },
            gap: 1,
          }}
        >
          <TextField
            label="品番"
            value={form.productCode}
            onChange={(e) => setFormField('productCode', e.target.value)}
          />
          <TextField
            label="商品名"
            value={form.productName}
            onChange={(e) => setFormField('productName', e.target.value)}
          />
          <TextField
            label="納品工場（例：76A）"
            value={form.factoryCode}
            onChange={(e) => setFormField('factoryCode', e.target.value)}
          />

          <TextField
            label="納品総数（見積数量）"
            value={form.totalQty}
            onChange={(e) => setFormField('totalQty', e.target.value)}
            placeholder="例：200"
          />
          <TextField
            label="1梱包に入る数量（ロット）"
            value={form.lotQty}
            onChange={(e) => setFormField('lotQty', e.target.value)}
            placeholder="例：50"
            helperText={lotFromPackage ? `梱包登録から自動取得：${lotFromPackage}` : '梱包登録が無い場合は手入力してください'}
          />
          <TextField
            label="納品予定合計（見積）"
            value={String(scheduleSum)}
            disabled
          />
        </Box>

        <Box sx={{ mt: 1 }}>
          <Typography sx={{ opacity: 0.8, fontSize: 13 }}>
            未割当（在庫候補） = 見積総数（{totalQtyNum}） − 納品予定合計（{scheduleSum}） ={' '}
            <b>{remainQty}</b>
          </Typography>
          {remainQty < 0 && (
            <Typography sx={{ mt: 0.5, color: 'warning.main', fontSize: 12 }}>
              ※ 注意：納品予定合計が見積総数を超えています（入力値を確認してください）
            </Typography>
          )}
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* ③ 納品行（分割後） */}
        <Typography sx={{ fontWeight: 900, mb: 1 }}>
          ③ 納品日・納品数量（ロット分割後／ここも編集OK）
        </Typography>

        <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap' }}>
          <Button variant="outlined" onClick={regenerateByLot} disabled={!scheduleNorm.length}>
            ロットで再分割（見積を元に再計算）
          </Button>
          <Button variant="outlined" onClick={addLine}>
            行を追加
          </Button>
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ opacity: 0.75, fontSize: 12 }}>
            ※ 分割後合計（編集後）: {linesSum}
          </Typography>
        </Stack>

        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 60 }}>No</TableCell>
              <TableCell>納品日</TableCell>
              <TableCell sx={{ width: 180 }}>納品数量</TableCell>
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
                    placeholder="例：1月30日（2行目以降は空欄でもOK）"
                    fullWidth
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    variant="standard"
                    value={String(r.qty ?? '')}
                    onChange={(e) => updateLine(r.id, { qty: e.target.value })}
                    placeholder="例：50"
                    fullWidth
                    inputProps={{ style: { textAlign: 'right' } }}
                  />
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
                <TableCell colSpan={4} sx={{ opacity: 0.7 }}>
                  納品行がありません。見積の納品予定が未入力か、ロット再分割ができていません。
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <Divider sx={{ my: 2 }} />

        <Stack direction="row" spacing={1} flexWrap="wrap">
          <Button variant="contained" onClick={downloadPdf} disabled={!canExport || loading}>
            PDF出力（ダウンロード）
          </Button>
        </Stack>
      </Paper>

      {/* ④ PDFプレビュー（キャプチャ対象） */}
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
                width: 794, // だいたいA4幅相当
                background: '#fff',
                color: '#111',
                p: 3,
                border: '1px solid rgba(0,0,0,0.15)',
                borderRadius: 1,
                fontFamily: 'sans-serif',
              }}
            >
              <Typography sx={{ fontSize: 18, fontWeight: 900, mb: 1 }}>
                納品予定一覧（ロット分割）
              </Typography>

              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 2 }}>
                <Box sx={{ fontSize: 12 }}>
                  <div><b>品番：</b>{form.productCode}</div>
                  <div><b>商品名：</b>{form.productName}</div>
                  <div><b>納品工場：</b>{form.factoryCode}</div>
                </Box>
                <Box sx={{ fontSize: 12 }}>
                  <div><b>納品総数：</b>{totalQtyNum}</div>
                  <div><b>1梱包ロット：</b>{toInt(form.lotQty)}</div>
                  <div><b>未割当（在庫候補）：</b>{remainQty}</div>
                </Box>
              </Box>

              <Box
                component="table"
                sx={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 12,
                }}
              >
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
                  </Box>
                </Box>

                <Box component="tbody">
                  {lines.map((r, idx) => (
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
                    </Box>
                  ))}
                </Box>
              </Box>

              <Typography sx={{ mt: 2, fontSize: 11, opacity: 0.8 }}>
                ※ 納品数量がロットを超える場合は自動分割（例：60 → 50 + 10）。このプレビュー上の内容は全て編集欄で変更可能です。
              </Typography>
            </Box>
          </Box>
        )}
      </Paper>

      {/* デバッグ用（必要なら残してOK） */}
      {estimateRow && (
        <Typography sx={{ mt: 2, opacity: 0.5, fontSize: 11 }}>
          （内部参照）estimate id: {estimateRow.id || '-'}
        </Typography>
      )}
    </Box>
  );
}
