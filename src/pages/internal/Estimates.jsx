import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient.jsx';
import RequireRole from '../../components/RequireRole.jsx';

import EstimateForm from './EstimateForm.jsx';
import EstimatePDF from './EstimatePDF.jsx';

import { useReactToPrint } from 'react-to-print';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

import {
  Alert,
  Box,
  Button,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';

const KAWASAKI_CLIENT_NAME = '川崎重工業株式会社';

const PRODUCT_TYPE_OPTIONS = [
  { value: 'ENGINE', label: '小型エンジン' },
  { value: 'OM', label: 'O/M' },
  { value: 'OTHER', label: 'その他' },
];

const DELIVERY_FACTORY_OPTIONS = [
  { value: '75', label: '75工場' },
  { value: '76', label: '76工場' },
  { value: '85', label: '85工場' },
  { value: '86', label: '86工場' },
];

const ESTIMATE_SELECT = `
  id,
  title,
  created_at,
  client_id,
  product_id,
  delivery_factory,
  kawasaki_order_no,
  delivery_schedule,
  product:products (
    id,
    product_code,
    name,
    product_type,
    unit_price,
    active
  )
`;

function productTypeLabel(v) {
  return PRODUCT_TYPE_OPTIONS.find((x) => x.value === v)?.label || String(v || '');
}

function factoryLabel(v) {
  return DELIVERY_FACTORY_OPTIONS.find((x) => x.value === v)?.label || (v ? String(v) : '');
}

function sanitizeFileName(s) {
  return String(s || 'file').replace(/[\\/:*?"<>|]/g, '');
}

function toNumLoose(v) {
  if (v === null || v === undefined) return 0;
  const s = String(v).trim();
  if (s === '') return 0;
  // 例: "1,000部" → "1000"
  const normalized = s.replace(/,/g, '').replace(/[^\d.-]/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

/** deliveryRows の1行を作る（React key 用 uid 付き） */
function makeDeliveryRow(init = {}) {
  const uid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(16).slice(2)}`;

  return {
    uid,
    date: '',
    qty: '',
    ...init,
  };
}

/**
 * react-to-print が生成した「画面外 iframe」を掃除する保険。
 * ※印刷開始直後に消すと印刷が出ないことがあるため、
 *   基本は「起動時」と「印刷完了後」にだけ使う。
 */
function cleanupReactToPrintIframes() {
  try {
    const iframes = Array.from(document.querySelectorAll('iframe'));
    for (const iframe of iframes) {
      const style = (iframe.getAttribute('style') || '').toLowerCase();

      // react-to-printが作る iframe は「absolute + 画面外」に置かれるケースが多い
      const looksOffscreen =
        style.includes('position: absolute') && (style.includes('top: -') || style.includes('left: -'));

      const maybePrint =
        looksOffscreen ||
        (iframe.id && String(iframe.id).toLowerCase().includes('print')) ||
        (iframe.name && String(iframe.name).toLowerCase().includes('print')) ||
        (iframe.title && String(iframe.title).toLowerCase().includes('print'));

      if (maybePrint) {
        iframe.parentNode?.removeChild(iframe);
      }
    }
  } catch {
    // noop
  }
}

function normalizeSchedule(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function buildScheduleFromRows(rows) {
  const list = (rows || [])
    .map((r) => {
      const date = String(r?.date || '').trim();
      const qtyRaw = String(r?.qty ?? '').trim();

      const hasAny = date !== '' || qtyRaw !== '';
      if (!hasAny) return null;

      const qty = qtyRaw === '' ? null : Math.round(toNumLoose(qtyRaw));
      return { date: date || null, qty };
    })
    .filter(Boolean);

  // DBには「入力されている分だけ」保存
  return list;
}

async function ensureKawasakiClient() {
  // 1) 既存検索
  const { data: found, error: findErr } = await supabase
    .from('clients')
    .select('id,name')
    .eq('name', KAWASAKI_CLIENT_NAME)
    .maybeSingle();

  if (findErr) throw findErr;
  if (found?.id) return found.id;

  // 2) 無ければ作成
  const { data: inserted, error: insErr } = await supabase
    .from('clients')
    .insert({ name: KAWASAKI_CLIENT_NAME })
    .select('id')
    .single();

  if (insErr) throw insErr;
  return inserted.id;
}

async function upsertProduct({ product_code, product_type, name }) {
  const code = String(product_code || '').trim();
  if (!code) throw new Error('品番が空です');

  // 既存検索
  const { data: existing, error: findErr } = await supabase
    .from('products')
    .select('id, product_code, name, product_type')
    .eq('product_code', code)
    .maybeSingle();

  if (findErr) throw findErr;

  // あれば更新（type は上書き、name は入力がある時のみ上書き）
  if (existing?.id) {
    const patch = { product_type };
    if (String(name || '').trim() !== '') patch.name = String(name).trim();

    const { data: updated, error: updErr } = await supabase
      .from('products')
      .update(patch)
      .eq('id', existing.id)
      .select('id')
      .single();

    if (updErr) throw updErr;
    return updated.id;
  }

  // 無ければ作成
  const { data: inserted, error: insErr } = await supabase
    .from('products')
    .insert({
      product_code: code,
      product_type,
      name: String(name || '').trim() || null,
      unit_price: 0,
      active: true,
    })
    .select('id')
    .single();

  if (insErr) throw insErr;
  return inserted.id;
}

export default function Estimates() {
  const [clientId, setClientId] = useState(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [error, setError] = useState('');

  const [estimates, setEstimates] = useState([]);
  const [selectedEstimate, setSelectedEstimate] = useState(null);
  const [selectedEstimateDetails, setSelectedEstimateDetails] = useState([]);

  // 新規作成フォーム：品番＋商品種類＋商品名（任意）
  const [partNumber, setPartNumber] = useState('');
  const [productType, setProductType] = useState('ENGINE');
  const [productName, setProductName] = useState('');

  // 見積ヘッダ（納品情報）※PDFに反映
  const [deliveryFactory, setDeliveryFactory] = useState('');
  const [kawasakiOrderNo, setKawasakiOrderNo] = useState('');

  // ★ 最初は 1 行だけ（追加ボタンで無制限に増やす）
  const [deliveryRows, setDeliveryRows] = useState([makeDeliveryRow()]);

  const [metaDirty, setMetaDirty] = useState(false);

  // ========== 納品予定（可変行）操作 ==========
  const addDeliveryRow = () => {
    setDeliveryRows((prev) => [...prev, makeDeliveryRow()]);
    // 追加しただけ（空行）ではDB上の値は変わらないので metaDirty は触らない
  };

  const removeDeliveryRow = (uid) => {
    setDeliveryRows((prev) => {
      const next = prev.filter((r) => r.uid !== uid);
      return next.length > 0 ? next : [makeDeliveryRow()];
    });
    setMetaDirty(true);
  };

  const updateDeliveryRow = (uid, patch) => {
    setDeliveryRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
    setMetaDirty(true);
  };

  const clearDeliveryRows = () => {
    setDeliveryRows([makeDeliveryRow()]);
    setMetaDirty(true);
  };

  // ========== 印刷（react-to-print） ==========
  // ★重要：ref は「DOM要素」に付ける（EstimatePDFコンポーネントに ref を付けない）
  const pdfRef = useRef(null);

  // 起動時/アンマウント時に「残骸だけ」掃除（HMRでも残りにくくする）
  useEffect(() => {
    cleanupReactToPrintIframes();
    return () => cleanupReactToPrintIframes();
  }, []);

  // PDFに渡す用：DBのselectedEstimateに、画面入力中のメタ情報を上書き（保存前でも即反映）
  const estimateForPdf = useMemo(() => {
    if (!selectedEstimate) return null;

    return {
      ...selectedEstimate,
      delivery_factory: deliveryFactory || null,
      kawasaki_order_no: String(kawasakiOrderNo || '').trim() || null,
      delivery_schedule: buildScheduleFromRows(deliveryRows),
    };
  }, [selectedEstimate, deliveryFactory, kawasakiOrderNo, deliveryRows]);

  // useReactToPrintの本体（DOMを返すので findDOMNode 依存が減る）
  const print = useReactToPrint({
    content: () => pdfRef.current,
    documentTitle: '見積書',
    removeAfterPrint: true,
    onAfterPrint: () => {
      // ★印刷後だけ掃除（ここは安全）
      cleanupReactToPrintIframes();
      try {
        window.focus();
      } catch {
        // noop
      }
    },
  });

  // JSXで使うハンドラ
  const handlePrint = () => {
    if (!pdfRef.current) {
      alert('PDF参照がありません（印刷対象が未生成です）');
      return;
    }

    // 古い残骸だけ掃除（印刷開始後すぐ消すとプレビューが出ないことがあるため、ここは事前のみ）
    cleanupReactToPrintIframes();

    // 印刷実行
    print?.();
  };

  const fetchEstimates = async (cid) => {
    const { data, error: fetchErr } = await supabase
      .from('estimates')
      .select(ESTIMATE_SELECT)
      .eq('client_id', cid)
      .order('created_at', { ascending: false });

    if (fetchErr) throw fetchErr;
    setEstimates(data || []);
  };

  // html2canvas + jsPDF（ダウンロード）
  const handleDownloadPdf = async () => {
    if (!pdfRef.current) {
      alert('PDF参照がありません');
      return;
    }
    try {
      const canvas = await html2canvas(pdfRef.current, { scale: 2, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'pt', 'a4');

      const pdfW = pdf.internal.pageSize.getWidth();
      const imgW = pdfW;
      const imgH = (canvas.height * imgW) / canvas.width;

      pdf.addImage(imgData, 'PNG', 0, 0, imgW, imgH);

      const code = estimateForPdf?.product?.product_code || estimateForPdf?.title || '見積書';
      const safe = sanitizeFileName(code);
      pdf.save(`${safe}_estimate.pdf`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert('PDF作成に失敗しました');
    }
  };

  // 初期：川崎得意先を確保し、見積一覧取得
  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setError('');
      try {
        const cid = await ensureKawasakiClient();
        if (!alive) return;
        setClientId(cid);
        await fetchEstimates(cid);
      } catch (e) {
        if (!alive) return;
        setError(e?.message || '初期化に失敗しました');
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const addEstimate = async () => {
    if (!clientId) {
      alert('得意先（川崎）IDが確定していません');
      return;
    }

    const code = String(partNumber || '').trim();
    if (!code) {
      alert('品番を入力してください');
      return;
    }

    setBusy(true);
    setError('');

    try {
      // 1) products を upsert（起点：品番＋商品種類）
      const productId = await upsertProduct({
        product_code: code,
        product_type: productType,
        name: productName,
      });

      // 2) estimates 作成
      const { data: inserted, error: insErr } = await supabase
        .from('estimates')
        .insert({
          client_id: clientId,
          product_id: productId,
          title: code, // title は UI 上「品番」として扱う

          // ↓ 新規追加カラム（SQL実行済み前提）
          delivery_factory: null,
          kawasaki_order_no: null,
          delivery_schedule: [],
        })
        .select(ESTIMATE_SELECT)
        .single();

      if (insErr) throw insErr;

      // 3) 一覧更新 + 選択
      await fetchEstimates(clientId);
      setSelectedEstimate(inserted);
      setSelectedEstimateDetails([]);

      // 入力リセット
      setPartNumber('');
      setProductName('');
      setProductType('ENGINE');
    } catch (e) {
      setError(e?.message || '見積作成に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const deleteEstimate = async (estimateId) => {
    if (!window.confirm('この見積を削除します。よろしいですか？')) return;
    if (!clientId) return;

    setBusy(true);
    setError('');

    try {
      const { error: delErr } = await supabase.from('estimates').delete().eq('id', estimateId);
      if (delErr) throw delErr;

      await fetchEstimates(clientId);

      if (selectedEstimate?.id === estimateId) {
        setSelectedEstimate(null);
        setSelectedEstimateDetails([]);
      }
    } catch (e) {
      setError(e?.message || '削除に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  // 選択見積が切り替わったら、ヘッダ（納品情報）を読み込み
  useEffect(() => {
    if (!selectedEstimate?.id) return;

    setDeliveryFactory(selectedEstimate.delivery_factory || '');
    setKawasakiOrderNo(selectedEstimate.kawasaki_order_no || '');

    // ★ ここが重要：固定3行ではなく「保存されている分だけ」復元（無限対応）
    const schedule = normalizeSchedule(selectedEstimate.delivery_schedule);

    const rows =
      schedule.length > 0
        ? schedule.map((r) =>
            makeDeliveryRow({
              date: typeof r?.date === 'string' ? r.date : '',
              qty: r?.qty === null || r?.qty === undefined ? '' : String(r.qty),
            })
          )
        : [makeDeliveryRow()];

    setDeliveryRows(rows);
    setMetaDirty(false);
  }, [selectedEstimate?.id]);

  const saveEstimateMeta = async () => {
    if (!selectedEstimate?.id) return;

    setBusy(true);
    setError('');

    try {
      const schedule = buildScheduleFromRows(deliveryRows);

      const { data, error: updErr } = await supabase
        .from('estimates')
        .update({
          delivery_factory: deliveryFactory || null,
          kawasaki_order_no: String(kawasakiOrderNo || '').trim() || null,
          delivery_schedule: schedule,
        })
        .eq('id', selectedEstimate.id)
        .select(ESTIMATE_SELECT)
        .single();

      if (updErr) throw updErr;

      setSelectedEstimate(data);
      setMetaDirty(false);

      if (clientId) {
        await fetchEstimates(clientId);
      }
    } catch (e) {
      setError(e?.message || '納品・注文情報の保存に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  // ★ selectedSummary（名前を統一）
  const selectedSummary = useMemo(() => {
    const code = selectedEstimate?.product?.product_code || selectedEstimate?.title || '';
    const type = selectedEstimate?.product?.product_type || '';
    const name = selectedEstimate?.product?.name || '';
    return { code, type, name };
  }, [selectedEstimate]);

  return (
    <RequireRole allow={['staff', 'admin']}>
      <Box sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Typography variant="h5" fontWeight={900}>
            見積（社内）
          </Typography>

          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            得意先は固定（{KAWASAKI_CLIENT_NAME}）。起点は「品番＋商品種類」です。
          </Typography>

          {error && <Alert severity="error">{error}</Alert>}

          {/* 新規作成 */}
          <Paper sx={{ p: 2 }}>
            <Stack spacing={1.5}>
              <Typography fontWeight={800}>新規見積を作成</Typography>

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                <TextField
                  label="【必須】品名（例：999817-0001）"
                  value={partNumber}
                  onChange={(e) => setPartNumber(e.target.value)}
                  placeholder="例：O/M ZR900S  99817-0041"
                  fullWidth
                />

                <FormControl sx={{ minWidth: 180 }}>
                  <InputLabel id="product-type-label">商品種類</InputLabel>
                  <Select
                    labelId="product-type-label"
                    label="商品種類"
                    value={productType}
                    onChange={(e) => setProductType(e.target.value)}
                  >
                    {PRODUCT_TYPE_OPTIONS.map((opt) => (
                      <MenuItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <TextField
                  label="【必須】商品名（例：ZX103A）"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  placeholder="例：Kawasaki OM ZR900S"
                  fullWidth
                />
              </Stack>

              <Stack direction="row" spacing={1}>
                <Button variant="contained" onClick={addEstimate} disabled={busy || loading}>
                  {busy ? '作成中…' : '見積を追加'}
                </Button>
              </Stack>
            </Stack>
          </Paper>

          {/* 一覧 */}
          <Paper sx={{ p: 2 }}>
            <Stack spacing={1}>
              <Typography fontWeight={800}>見積一覧</Typography>

              {loading ? (
                <Typography sx={{ color: 'text.secondary' }}>読み込み中…</Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>作成日</TableCell>
                      <TableCell>品番</TableCell>
                      <TableCell>商品種類</TableCell>
                      <TableCell>商品名</TableCell>
                      <TableCell align="right">操作</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {estimates.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} sx={{ textAlign: 'center', color: 'text.secondary' }}>
                          見積がありません
                        </TableCell>
                      </TableRow>
                    ) : (
                      estimates.map((est) => (
                        <TableRow key={est.id} hover>
                          <TableCell>
                            {est.created_at ? new Date(est.created_at).toLocaleString('ja-JP') : ''}
                          </TableCell>
                          <TableCell>{est.product?.product_code || est.title}</TableCell>
                          <TableCell>{productTypeLabel(est.product?.product_type)}</TableCell>
                          <TableCell>{est.product?.name || ''}</TableCell>
                          <TableCell align="right">
                            <Stack direction="row" spacing={1} justifyContent="flex-end">
                              <Button
                                size="small"
                                variant="outlined"
                                onClick={() => {
                                  setSelectedEstimate(est);
                                  setSelectedEstimateDetails([]);
                                }}
                              >
                                開く
                              </Button>
                              <Button
                                size="small"
                                color="error"
                                variant="outlined"
                                onClick={() => deleteEstimate(est.id)}
                                disabled={busy}
                              >
                                削除
                              </Button>
                            </Stack>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </Stack>
          </Paper>

          {/* 選択中の見積 */}
          {selectedEstimate && (
            <Paper sx={{ p: 2 }}>
              <Stack spacing={2}>
                <Stack spacing={0.5}>
                  <Typography variant="h6" fontWeight={900}>
                    見積編集
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    見積ID: {selectedEstimate.id}
                  </Typography>

                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    品番: {selectedSummary.code} / 商品種類: {productTypeLabel(selectedSummary.type)}{' '}
                    {selectedSummary.name ? `/ 商品名: ${selectedSummary.name}` : ''}
                  </Typography>
                </Stack>

                <Divider />

                {/* ★ 追加：納品・注文情報（PDFに反映） */}
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Stack spacing={2}>
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
                      <Typography fontWeight={900} sx={{ minWidth: 220 }}>
                        納品・注文情報（PDFに反映）
                      </Typography>

                      <Stack direction="row" spacing={1} alignItems="center">
                        <Button variant="contained" onClick={saveEstimateMeta} disabled={busy || !metaDirty}>
                          {busy ? '保存中…' : '保存'}
                        </Button>
                        {metaDirty && (
                          <Typography variant="body2" sx={{ color: 'warning.main' }}>
                            未保存の変更があります
                          </Typography>
                        )}
                      </Stack>
                    </Stack>

                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                      <FormControl sx={{ minWidth: 220 }}>
                        <InputLabel id="delivery-factory-label">納品工場</InputLabel>
                        <Select
                          labelId="delivery-factory-label"
                          label="納品工場"
                          value={deliveryFactory}
                          onChange={(e) => {
                            setDeliveryFactory(e.target.value);
                            setMetaDirty(true);
                          }}
                        >
                          <MenuItem value="">
                            <em>未設定</em>
                          </MenuItem>
                          {DELIVERY_FACTORY_OPTIONS.map((opt) => (
                            <MenuItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>

                      <TextField
                        label="川崎重工 注文番号"
                        value={kawasakiOrderNo}
                        onChange={(e) => {
                          setKawasakiOrderNo(e.target.value);
                          setMetaDirty(true);
                        }}
                        placeholder="例：KJ0366"
                        fullWidth
                      />
                    </Stack>

                    <Divider />

                    <Typography fontWeight={800}>納品予定（追加で無制限）</Typography>

                    <Stack spacing={1.5}>
                      {deliveryRows.map((row, idx) => (
                        <Stack
                          key={row.uid}
                          direction={{ xs: 'column', md: 'row' }}
                          spacing={2}
                          alignItems={{ md: 'center' }}
                        >
                          <TextField
                            type="date"
                            label={`納品日 ${idx + 1}`}
                            value={row?.date || ''}
                            onChange={(e) => updateDeliveryRow(row.uid, { date: e.target.value })}
                            InputLabelProps={{ shrink: true }}
                            sx={{ minWidth: 220 }}
                          />

                          <TextField
                            label={`納品数量 ${idx + 1}`}
                            value={row?.qty ?? ''}
                            onChange={(e) => updateDeliveryRow(row.uid, { qty: e.target.value })}
                            placeholder="例：50"
                            sx={{ minWidth: 220 }}
                          />

                          <Stack direction="row" spacing={1} alignItems="center">
                            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                              （未入力でもOK。入力した分だけPDFに出します）
                            </Typography>

                            <Button
                              size="small"
                              color="error"
                              variant="outlined"
                              onClick={() => removeDeliveryRow(row.uid)}
                              disabled={deliveryRows.length <= 1}
                            >
                              削除
                            </Button>
                          </Stack>
                        </Stack>
                      ))}
                    </Stack>

                    <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap">
                      <Button variant="outlined" onClick={addDeliveryRow}>
                        納品予定を追加
                      </Button>
                      <Button variant="text" onClick={clearDeliveryRows}>
                        クリア（1行に戻す）
                      </Button>
                      <Typography variant="body2" sx={{ color: 'text.secondary', alignSelf: 'center' }}>
                        現在 {deliveryRows.length} 行
                      </Typography>
                    </Stack>
                  </Stack>
                </Paper>

                <Divider />

                <EstimateForm
                  estimateId={selectedEstimate.id}
                  onDetailsLoaded={(details) => setSelectedEstimateDetails(details)}
                  meta={{
                    deliveryFactory,
                    deliveryFactoryLabel: factoryLabel(deliveryFactory),
                    kawasakiOrderNo,
                    deliverySchedule: buildScheduleFromRows(deliveryRows),
                  }}
                />

                <Divider />

                <Stack direction="row" spacing={1} flexWrap="wrap">
                  <Button variant="contained" onClick={handlePrint}>
                    PDF出力（印刷プレビュー）
                  </Button>
                  <Button variant="outlined" onClick={handleDownloadPdf}>
                    PDFをダウンロード
                  </Button>
                  <Button
                    variant="text"
                    onClick={() => {
                      setSelectedEstimate(null);
                      setSelectedEstimateDetails([]);
                    }}
                  >
                    閉じる
                  </Button>
                </Stack>

                {/* 印刷対象：画面外（refはDOMに付ける） */}
                <Box sx={{ position: 'absolute', top: -9999, left: -9999 }}>
                  <div ref={pdfRef}>
                    <EstimatePDF estimate={estimateForPdf} details={selectedEstimateDetails} />
                  </div>
                </Box>

                {/* 参考：今入っている納品情報を軽く表示（任意） */}
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  納品工場: {factoryLabel(deliveryFactory) || '未設定'} / 注文番号:{' '}
                  {String(kawasakiOrderNo || '').trim() || '未設定'}
                </Typography>
              </Stack>
            </Paper>
          )}

          <Paper sx={{ p: 2, bgcolor: 'background.default' }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              備考：品番・商品種類は products マスタに自動登録（upsert）されます。以後、伝票・梱包・計画書など全機能の起点として
              products を参照できます。
            </Typography>
          </Paper>
        </Stack>
      </Box>
    </RequireRole>
  );
}
