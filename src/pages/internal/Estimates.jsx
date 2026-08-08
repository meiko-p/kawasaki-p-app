import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient.jsx';

import EstimateForm from './EstimateForm.jsx';
import EstimatePDF from './EstimatePDF.jsx';

import { useReactToPrint } from 'react-to-print';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
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

const KAWASAKI_CLIENT_NAME = '川崎重工業株式会社';

const PRODUCT_TYPE_LABELS = {
  ENGINE: '小型エンジン',
  OM: 'O/M',
  OTHER: 'その他',
};

function productTypeLabel(value) {
  return PRODUCT_TYPE_LABELS[value] || String(value || '');
}

function factoryLabel(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  return digits ? `${Number(digits)}工場` : String(value || '');
}

function formatDateJa(value) {
  if (!value) return '';
  const [year, month, day] = String(value).split('-');
  if (!year || !month || !day) return String(value);
  return `${year}/${month}/${day}`;
}

function normalizeSchedule(raw) {
  const source = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? (() => {
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : [];

  return source
    .map((row, index) => ({
      id: String(row?.id || `line-${index}`),
      date: String(row?.date || ''),
      qty: Number(row?.qty ?? row?.quantity ?? 0) || 0,
    }))
    .filter((row) => row.date || row.qty > 0);
}

function sanitizeFileName(value) {
  return String(value || 'estimate').replace(/[\\/:*?"<>|]/g, '_');
}


function safeNumber(value) {
  const normalized = String(value ?? '')
    .replace(/[０-９]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0xfee0),
    )
    .replace(/[，,]/g, '')
    .replace(/[^\d.-]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function formatUnitPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0.00';
  return number.toLocaleString('ja-JP', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function ensureKawasakiClient() {
  const { data: existing, error: findError } = await supabase
    .from('clients')
    .select('id, name')
    .eq('name', KAWASAKI_CLIENT_NAME)
    .maybeSingle();

  if (findError) throw findError;
  if (existing?.id) return existing.id;

  const { data: created, error: createError } = await supabase
    .from('clients')
    .insert({ name: KAWASAKI_CLIENT_NAME })
    .select('id')
    .single();

  if (createError) throw createError;
  return created.id;
}

export default function Estimates() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const filterProductId = params.get('product_id') || '';

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);

  const [planItem, setPlanItem] = useState(null);
  const [planDate, setPlanDate] = useState('');

  const [estimates, setEstimates] = useState([]);
  const [selectedEstimate, setSelectedEstimate] = useState(null);
  const [selectedEstimateDetails, setSelectedEstimateDetails] = useState([]);

  // 見積PDF専用の表示数量・備考。見積計算時の数量とは分離して保持します。
  const [quoteQuantity, setQuoteQuantity] = useState('');
  const [quoteNote, setQuoteNote] = useState('');
  const [quoteDirty, setQuoteDirty] = useState(false);

  const pdfRef = useRef(null);

  const clearMessages = () => {
    setError('');
    setSuccess('');
  };

  const fetchProducts = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('products')
      .select('id, product_code, name, product_type, active, plan_registered')
      .eq('active', true)
      .eq('plan_registered', true)
      .order('product_code', { ascending: true })
      .limit(1000);

    if (fetchError) throw fetchError;
    setProducts(data || []);
  }, []);

  const fetchProductContext = useCallback(async (product) => {
    if (!product?.id) {
      setPlanItem(null);
      setPlanDate('');
      setEstimates([]);
      setSelectedEstimate(null);
      setSelectedEstimateDetails([]);
      return;
    }

    setLoading(true);
    clearMessages();

    try {
      const [{ data: itemRows, error: itemError }, { data: estimateRows, error: estimateError }] =
        await Promise.all([
          supabase
            .from('order_plan_items')
            .select(
              `
                id,
                order_plan_id,
                product_id,
                print_order_qty,
                delivery_factory,
                kawasaki_order_no,
                delivery_schedule,
                memo,
                created_at,
                updated_at,
                order_plan:order_plans (
                  id,
                  plan_date,
                  title,
                  image_path
                )
              `,
            )
            .eq('product_id', product.id)
            .order('created_at', { ascending: false })
            .limit(1),
          supabase
            .from('estimates')
            .select(
              `
                id,
                title,
                created_at,
                updated_at,
                client_id,
                product_id,
                order_plan_item_id,
                print_order_qty,
                quote_quantity,
                quote_note,
                quote_total_amount,
                quote_unit_price,
                delivery_factory,
                kawasaki_order_no,
                delivery_schedule,
                product:products (
                  id,
                  product_code,
                  name,
                  product_type,
                  active,
                  plan_registered
                )
              `,
            )
            .eq('product_id', product.id)
            .order('created_at', { ascending: false }),
        ]);

      if (itemError) throw itemError;
      if (estimateError) throw estimateError;

      const latestPlanItem = itemRows?.[0] || null;
      const list = estimateRows || [];

      setPlanItem(latestPlanItem);
      setPlanDate(latestPlanItem?.order_plan?.plan_date || '');
      setEstimates(list);

      if (list.length > 0) {
        setSelectedEstimate(list[0]);
        setSelectedEstimateDetails([]);
      } else {
        setSelectedEstimate(null);
        setSelectedEstimateDetails([]);
      }
    } catch (loadError) {
      // eslint-disable-next-line no-console
      console.error(loadError);
      setError(loadError?.message || '品番に紐づく見積情報の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        await fetchProducts();
      } catch (initialError) {
        if (!active) return;
        // eslint-disable-next-line no-console
        console.error(initialError);
        setError(initialError?.message || '計画書登録済み品番の取得に失敗しました');
      }
    })();

    return () => {
      active = false;
    };
  }, [fetchProducts]);

  useEffect(() => {
    if (!filterProductId || products.length === 0 || selectedProduct?.id) return;
    const matched = products.find((product) => String(product.id) === String(filterProductId));
    if (matched) setSelectedProduct(matched);
  }, [filterProductId, products, selectedProduct?.id]);

  useEffect(() => {
    fetchProductContext(selectedProduct);
  }, [fetchProductContext, selectedProduct]);

  useEffect(() => {
    if (!selectedEstimate?.id) {
      setQuoteQuantity('');
      setQuoteNote('');
      setQuoteDirty(false);
      return;
    }

    const initialQuoteQuantity =
      Number(selectedEstimate.quote_quantity || 0) > 0
        ? Number(selectedEstimate.quote_quantity)
        : Number(planItem?.print_order_qty || selectedEstimate.print_order_qty || 0);

    setQuoteQuantity(initialQuoteQuantity > 0 ? String(Math.round(initialQuoteQuantity)) : '');
    setQuoteNote(String(selectedEstimate.quote_note || ''));
    setQuoteDirty(false);
  }, [planItem?.print_order_qty, selectedEstimate]);

  const createEstimate = async () => {
    if (!selectedProduct?.id) {
      setError('計画書（発注）に登録済みの品番を選択してください');
      return;
    }

    if (!planItem?.id) {
      setError('この品番に計画書（発注）の明細がありません');
      return;
    }

    setBusy(true);
    clearMessages();

    try {
      const clientId = await ensureKawasakiClient();

      const { data: inserted, error: insertError } = await supabase
        .from('estimates')
        .insert({
          client_id: clientId,
          product_id: selectedProduct.id,
          order_plan_item_id: planItem.id,
          title: selectedProduct.product_code,
          print_order_qty: Math.max(0, Number(planItem.print_order_qty || 0)),
          quote_quantity: Math.max(0, Number(planItem.print_order_qty || 0)),
          quote_note: null,
          delivery_factory: planItem.delivery_factory || null,
          kawasaki_order_no: planItem.kawasaki_order_no || null,
          delivery_schedule: normalizeSchedule(planItem.delivery_schedule),
        })
        .select(
          `
            id,
            title,
            created_at,
            updated_at,
            client_id,
            product_id,
            order_plan_item_id,
            print_order_qty,
            quote_quantity,
            quote_note,
            quote_total_amount,
            quote_unit_price,
            delivery_factory,
            kawasaki_order_no,
            delivery_schedule,
            product:products (
              id,
              product_code,
              name,
              product_type,
              active,
              plan_registered
            )
          `,
        )
        .single();

      if (insertError) throw insertError;

      await fetchProductContext(selectedProduct);
      setSelectedEstimate(inserted);
      setSelectedEstimateDetails([]);
      setSuccess('選択した計画書品番から、新しい見積を作成しました');
    } catch (createError) {
      // eslint-disable-next-line no-console
      console.error(createError);
      setError(createError?.message || '見積の作成に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const deleteEstimate = async (estimate) => {
    if (!window.confirm(`見積「${estimate.title}」を削除します。よろしいですか？`)) {
      return;
    }

    setBusy(true);
    clearMessages();

    try {
      const { error: deleteError } = await supabase
        .from('estimates')
        .delete()
        .eq('id', estimate.id);

      if (deleteError) throw deleteError;

      await fetchProductContext(selectedProduct);
      setSuccess('見積を削除しました');
    } catch (deleteError) {
      // eslint-disable-next-line no-console
      console.error(deleteError);
      setError(deleteError?.message || '見積の削除に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const estimateTotalAmount = useMemo(
    () =>
      selectedEstimateDetails.reduce(
        (sum, detail) => sum + Number(detail?.total_estimated_cost || 0),
        0,
      ),
    [selectedEstimateDetails],
  );

  const quoteQuantityNumber = useMemo(
    () => Math.max(0, Math.round(safeNumber(quoteQuantity))),
    [quoteQuantity],
  );

  const quoteUnitPrice = useMemo(
    () => (quoteQuantityNumber > 0 ? estimateTotalAmount / quoteQuantityNumber : 0),
    [estimateTotalAmount, quoteQuantityNumber],
  );

  const estimateForPdf = useMemo(() => {
    if (!selectedEstimate) return null;

    return {
      ...selectedEstimate,
      product: selectedEstimate.product || selectedProduct,
      print_order_qty:
        Number(planItem?.print_order_qty || selectedEstimate.print_order_qty || 0) || 0,
      quote_quantity: quoteQuantityNumber,
      quote_note: String(quoteNote || '').trim(),
      quote_total_amount: estimateTotalAmount,
      quote_unit_price: quoteUnitPrice,
      delivery_factory: planItem?.delivery_factory || selectedEstimate.delivery_factory || null,
      kawasaki_order_no: planItem?.kawasaki_order_no || selectedEstimate.kawasaki_order_no || null,
      delivery_schedule:
        normalizeSchedule(planItem?.delivery_schedule).length > 0
          ? normalizeSchedule(planItem?.delivery_schedule)
          : normalizeSchedule(selectedEstimate.delivery_schedule),
    };
  }, [
    estimateTotalAmount,
    planItem,
    quoteNote,
    quoteQuantityNumber,
    quoteUnitPrice,
    selectedEstimate,
    selectedProduct,
  ]);

  const saveQuoteSettings = useCallback(
    async ({ silent = false } = {}) => {
      if (!selectedEstimate?.id) return null;

      if (quoteQuantityNumber <= 0) {
        throw new Error('見積り用の数量は1以上で入力してください');
      }

      const { data, error: updateError } = await supabase
        .from('estimates')
        .update({
          quote_quantity: quoteQuantityNumber,
          quote_note: String(quoteNote || '').trim() || null,
        })
        .eq('id', selectedEstimate.id)
        .select(
          `
            id,
            title,
            created_at,
            updated_at,
            client_id,
            product_id,
            order_plan_item_id,
            print_order_qty,
            quote_quantity,
            quote_note,
            quote_total_amount,
            quote_unit_price,
            delivery_factory,
            kawasaki_order_no,
            delivery_schedule,
            product:products (
              id,
              product_code,
              name,
              product_type,
              active,
              plan_registered
            )
          `,
        )
        .single();

      if (updateError) throw updateError;

      setSelectedEstimate(data);
      setEstimates((previous) =>
        previous.map((estimate) => (estimate.id === data.id ? data : estimate)),
      );
      setQuoteDirty(false);

      if (!silent) {
        setSuccess('見積PDF用の数量・備考を保存しました。単価登録にも自動反映されます');
      }

      return data;
    },
    [quoteNote, quoteQuantityNumber, selectedEstimate?.id],
  );

  const printEstimate = useReactToPrint({
    content: () => pdfRef.current,
    documentTitle: selectedProduct?.product_code
      ? `${selectedProduct.product_code}_見積書`
      : '見積書',
    removeAfterPrint: true,
  });

  const handlePrint = async () => {
    if (!pdfRef.current || !selectedEstimate) {
      alert('見積書の印刷対象がありません');
      return;
    }

    setBusy(true);
    clearMessages();

    try {
      await saveQuoteSettings({ silent: true });
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      printEstimate?.();
    } catch (printError) {
      // eslint-disable-next-line no-console
      console.error(printError);
      setError(printError?.message || '印刷プレビューの準備に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!pdfRef.current || !selectedEstimate) {
      alert('見積書のPDF対象がありません');
      return;
    }

    setBusy(true);
    clearMessages();

    try {
      await saveQuoteSettings({ silent: true });
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));

      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }

      const canvas = await html2canvas(pdfRef.current, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        scrollY: 0,
        windowWidth: pdfRef.current.scrollWidth,
        windowHeight: pdfRef.current.scrollHeight,
      });

      const imageData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const ratio = Math.min(pdfWidth / canvas.width, pdfHeight / canvas.height);
      const imageWidth = canvas.width * ratio;
      const imageHeight = canvas.height * ratio;
      const offsetX = (pdfWidth - imageWidth) / 2;
      const offsetY = (pdfHeight - imageHeight) / 2;

      pdf.addImage(imageData, 'PNG', offsetX, offsetY, imageWidth, imageHeight);

      const code = selectedProduct?.product_code || selectedEstimate.title || 'estimate';
      pdf.save(`${sanitizeFileName(code)}_registered_unit_price_estimate.pdf`);
    } catch (pdfError) {
      // eslint-disable-next-line no-console
      console.error(pdfError);
      setError(pdfError?.message || '見積PDFの作成に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const schedule = useMemo(
    () => normalizeSchedule(planItem?.delivery_schedule),
    [planItem?.delivery_schedule],
  );

  return (
    <Box sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h4" fontWeight={900}>
            見積（社内）
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
            新規品番の登録は行いません。計画書（発注）で登録済みの品番を検索し、その品番の見積を作成します。
          </Typography>
        </Box>

        {error && <Alert severity="error">{error}</Alert>}
        {success && <Alert severity="success">{success}</Alert>}

        {loading && (
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={18} />
            <Typography variant="body2">読み込み中…</Typography>
          </Stack>
        )}

        {/* 品番選択 */}
        <Paper sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Typography variant="h6" fontWeight={900}>
              ① 計画書（発注）に登録済みの品番を検索
            </Typography>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
              <Autocomplete
                options={products}
                value={selectedProduct}
                onChange={(_event, value) => setSelectedProduct(value)}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                getOptionLabel={(option) =>
                  option ? `${option.product_code}　${option.name || ''}` : ''
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="品番で検索・選択"
                    placeholder="例：99817-0126"
                  />
                )}
                sx={{ flex: 1 }}
              />

              <Button
                variant="outlined"
                onClick={() => navigate('/order-plans')}
                sx={{ minWidth: 220 }}
              >
                計画書（発注）へ
              </Button>
            </Stack>
          </Stack>
        </Paper>

        {/* 計画書情報 */}
        {selectedProduct && (
          <Paper sx={{ p: 2 }}>
            <Stack spacing={2}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                spacing={2}
                alignItems={{ md: 'center' }}
              >
                <Box sx={{ flex: 1 }}>
                  <Typography variant="h6" fontWeight={900}>
                    ② 計画書（発注）から引き継ぐ情報
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    品番：{selectedProduct.product_code} / 商品種類：
                    {productTypeLabel(selectedProduct.product_type)} / 商品名：
                    {selectedProduct.name || '-'}
                  </Typography>
                </Box>

                <Button
                  variant="contained"
                  onClick={createEstimate}
                  disabled={busy || !planItem}
                >
                  {busy ? '作成中…' : 'この品番で新しい見積を作成'}
                </Button>
              </Stack>

              {!planItem ? (
                <Alert severity="warning">
                  この品番は商品マスタにはありますが、計画書（発注）の明細が見つかりません。
                </Alert>
              ) : (
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', md: 'repeat(5, 1fr)' },
                    gap: 1.5,
                  }}
                >
                  <Paper variant="outlined" sx={{ p: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">
                      計画書日付
                    </Typography>
                    <Typography fontWeight={800}>{formatDateJa(planDate) || '-'}</Typography>
                  </Paper>

                  <Paper variant="outlined" sx={{ p: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">
                      納品工場
                    </Typography>
                    <Typography fontWeight={800}>
                      {factoryLabel(planItem.delivery_factory) || '-'}
                    </Typography>
                  </Paper>

                  <Paper variant="outlined" sx={{ p: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">
                      川崎重工 注文番号
                    </Typography>
                    <Typography fontWeight={800}>
                      {planItem.kawasaki_order_no || '-'}
                    </Typography>
                  </Paper>

                  <Paper variant="outlined" sx={{ p: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">
                      印刷手配数
                    </Typography>
                    <Typography fontWeight={900} color="primary.light">
                      {Math.max(0, Number(planItem.print_order_qty || 0)).toLocaleString('ja-JP')}冊
                    </Typography>
                  </Paper>

                  <Paper variant="outlined" sx={{ p: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">
                      納品予定件数
                    </Typography>
                    <Typography fontWeight={800}>{schedule.length}件</Typography>
                  </Paper>
                </Box>
              )}

              {schedule.length > 0 && (
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {schedule.map((row) => (
                    <Chip
                      key={row.id}
                      label={`${formatDateJa(row.date)} / ${row.qty}冊`}
                      variant="outlined"
                      color="error"
                    />
                  ))}
                </Stack>
              )}
            </Stack>
          </Paper>
        )}

        {/* 見積一覧 */}
        {selectedProduct && (
          <Paper sx={{ p: 2 }}>
            <Stack spacing={2}>
              <Typography variant="h6" fontWeight={900}>
                ③ この品番の見積一覧
              </Typography>

              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small" sx={{ minWidth: 760 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>作成日時</TableCell>
                      <TableCell>見積ID</TableCell>
                      <TableCell>品番</TableCell>
                      <TableCell>計画書連携</TableCell>
                      <TableCell align="right">操作</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {estimates.map((estimate) => (
                      <TableRow key={estimate.id} hover>
                        <TableCell>
                          {estimate.created_at
                            ? new Date(estimate.created_at).toLocaleString('ja-JP')
                            : '-'}
                        </TableCell>
                        <TableCell>{estimate.id}</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>
                          {estimate.product?.product_code || estimate.title}
                        </TableCell>
                        <TableCell>
                          {estimate.order_plan_item_id ? (
                            <Chip size="small" label="連携済み" color="success" />
                          ) : (
                            <Chip size="small" label="旧データ" variant="outlined" />
                          )}
                        </TableCell>
                        <TableCell align="right">
                          <Stack direction="row" spacing={1} justifyContent="flex-end">
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => {
                                setSelectedEstimate(estimate);
                                setSelectedEstimateDetails([]);
                              }}
                            >
                              開く
                            </Button>
                            <Button
                              size="small"
                              variant="outlined"
                              color="error"
                              onClick={() => deleteEstimate(estimate)}
                              disabled={busy}
                            >
                              削除
                            </Button>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ))}

                    {estimates.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} sx={{ textAlign: 'center', color: 'text.secondary' }}>
                          この品番の見積はまだありません。
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </Box>
            </Stack>
          </Paper>
        )}

        {/* 見積編集 */}
        {selectedEstimate && (
          <Paper sx={{ p: 2 }}>
            <Stack spacing={2}>
              <Box>
                <Typography variant="h6" fontWeight={900}>
                  ④ 見積編集
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  見積ID：{selectedEstimate.id} / 品番：
                  {selectedEstimate.product?.product_code || selectedEstimate.title}
                </Typography>
              </Box>

              <Divider />

              <EstimateForm
                key={selectedEstimate.id}
                estimateId={selectedEstimate.id}
                initialQuantity={
                  Number(planItem?.print_order_qty || selectedEstimate?.print_order_qty || 0) || 0
                }
                onDetailsLoaded={(details) => setSelectedEstimateDetails(details || [])}
                meta={{
                  deliveryFactory: planItem?.delivery_factory || '',
                  deliveryFactoryLabel: factoryLabel(planItem?.delivery_factory),
                  kawasakiOrderNo: planItem?.kawasaki_order_no || '',
                  printOrderQty:
                    Number(planItem?.print_order_qty || selectedEstimate?.print_order_qty || 0) || 0,
                  deliverySchedule: schedule,
                }}
              />

              <Divider />

              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={1.5}>
                  <Box>
                    <Typography variant="h6" fontWeight={900}>
                      ⑤ 見積PDF設定
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      見積計算の数量とは別に、登録単価見積書へ表示する数量を指定します。合計金額は変えず、単価だけを「合計金額 ÷ 見積り用の数量」で再計算します。
                    </Typography>
                  </Box>

                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', md: '280px 1fr' },
                      gap: 1.5,
                    }}
                  >
                    <TextField
                      label="見積り用の数量"
                      value={quoteQuantity}
                      onChange={(event) => {
                        setQuoteQuantity(event.target.value);
                        setQuoteDirty(true);
                      }}
                      placeholder="例：500"
                      inputProps={{ inputMode: 'numeric' }}
                      helperText="PDFの数量欄と、単価計算の割り算に使用します"
                    />

                    <TextField
                      label="備考"
                      value={quoteNote}
                      onChange={(event) => {
                        setQuoteNote(event.target.value);
                        setQuoteDirty(true);
                      }}
                      placeholder="例：まとめ数5部"
                      multiline
                      minRows={2}
                    />
                  </Box>

                  <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={2}
                    alignItems={{ md: 'center' }}
                  >
                    <Paper variant="outlined" sx={{ p: 1.5, minWidth: 220 }}>
                      <Typography variant="caption" color="text.secondary">
                        見積合計（税別）
                      </Typography>
                      <Typography fontWeight={900}>
                        {Math.round(estimateTotalAmount).toLocaleString('ja-JP')}円
                      </Typography>
                    </Paper>

                    <Paper variant="outlined" sx={{ p: 1.5, minWidth: 220 }}>
                      <Typography variant="caption" color="text.secondary">
                        PDF表示単価
                      </Typography>
                      <Typography fontWeight={900} color="primary.light">
                        @{formatUnitPrice(quoteUnitPrice)}円
                      </Typography>
                    </Paper>

                    <Button
                      variant="outlined"
                      onClick={async () => {
                        setBusy(true);
                        clearMessages();
                        try {
                          await saveQuoteSettings();
                        } catch (saveError) {
                          // eslint-disable-next-line no-console
                          console.error(saveError);
                          setError(saveError?.message || '見積PDF設定の保存に失敗しました');
                        } finally {
                          setBusy(false);
                        }
                      }}
                      disabled={busy || !quoteDirty}
                    >
                      {quoteDirty ? '見積PDF設定を保存' : '保存済み'}
                    </Button>
                  </Stack>
                </Stack>
              </Paper>

              <Divider />

              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Button variant="contained" onClick={handlePrint} disabled={busy}>
                  PDF出力（印刷プレビュー）
                </Button>
                <Button variant="outlined" onClick={handleDownloadPdf} disabled={busy}>
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

              {/* refはReactコンポーネントではなくDOMへ付与 */}
              <Box sx={{ position: 'absolute', top: -99999, left: -99999 }}>
                <div ref={pdfRef}>
                  <EstimatePDF
                    estimate={estimateForPdf}
                    details={selectedEstimateDetails}
                  />
                </div>
              </Box>
            </Stack>
          </Paper>
        )}
      </Stack>
    </Box>
  );
}
