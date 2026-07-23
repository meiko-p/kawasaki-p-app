import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient.jsx';

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
  TextField,
  Typography,
} from '@mui/material';

const PRODUCT_TYPE_LABELS = {
  ENGINE: '小型エンジン',
  OM: 'O/M',
  OTHER: 'その他',
};

function productTypeLabel(value) {
  return PRODUCT_TYPE_LABELS[value] || String(value || '');
}

function formatDateJa(value) {
  if (!value) return '日付未設定';
  const [year, month, day] = String(value).split('-');
  return year && month && day ? `${year}/${month}/${day}` : String(value);
}

function safeInteger(value) {
  const normalized = String(value ?? '')
    .replace(/[０-９]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0xfee0),
    )
    .replace(/[，,]/g, '')
    .replace(/[^\d-]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

function normalizeSchedule(raw) {
  let source = [];

  if (Array.isArray(raw)) {
    source = raw;
  } else if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      source = Array.isArray(parsed) ? parsed : [];
    } catch {
      source = [];
    }
  }

  return source.map((row, index) => ({
    id: String(row?.id || `legacy-${index}`),
    date: String(row?.date || ''),
    qty: safeInteger(row?.qty ?? row?.quantity ?? 0),
  }));
}

function factoryLabel(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  return digits ? `${Number(digits)}工場` : String(value || '');
}

function DoneStamp() {
  return (
    <Box
      sx={{
        width: 110,
        height: 110,
        border: '5px solid',
        borderColor: 'error.main',
        color: 'error.main',
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        transform: 'rotate(-8deg)',
        opacity: 0.9,
      }}
    >
      <Typography variant="h4" fontWeight={1000}>
        済
      </Typography>
    </Box>
  );
}

export default function Inventory() {
  const [params] = useSearchParams();
  const filterProductId = params.get('product_id') || '';

  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [planItem, setPlanItem] = useState(null);
  const [completionRows, setCompletionRows] = useState([]);
  const [shelfNumber, setShelfNumber] = useState('');
  const [inventoryMemo, setInventoryMemo] = useState('');

  const [loading, setLoading] = useState(false);
  const [busyLineId, setBusyLineId] = useState('');
  const [savingSetting, setSavingSetting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const clearMessages = () => {
    setError('');
    setSuccess('');
  };

  const loadProducts = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('products')
      .select('id, product_code, name, product_type, active, plan_registered')
      .eq('active', true)
      .eq('plan_registered', true)
      .order('product_code', { ascending: true })
      .limit(1000);

    if (fetchError) throw fetchError;
    setProducts(data || []);
    return data || [];
  }, []);

  const loadProductContext = useCallback(async (product) => {
    if (!product?.id) {
      setPlanItem(null);
      setCompletionRows([]);
      setShelfNumber('');
      setInventoryMemo('');
      return;
    }

    setLoading(true);
    clearMessages();

    try {
      const { data: itemRows, error: itemError } = await supabase
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
              updated_at
            )
          `,
        )
        .eq('product_id', product.id)
        .order('updated_at', { ascending: false })
        .limit(1);

      if (itemError) throw itemError;
      const latestItem = itemRows?.[0] || null;
      setPlanItem(latestItem);

      if (!latestItem?.id) {
        setCompletionRows([]);
      } else {
        const { data: completions, error: completionError } = await supabase
          .from('order_plan_delivery_completions')
          .select(
            'id, order_plan_item_id, delivery_line_id, delivered_qty, completed_at, completed_by, created_at, updated_at',
          )
          .eq('order_plan_item_id', latestItem.id)
          .order('completed_at', { ascending: true });

        if (completionError) throw completionError;
        setCompletionRows(completions || []);
      }

      const { data: setting, error: settingError } = await supabase
        .from('inventory_product_settings')
        .select('product_id, shelf_number, memo, updated_at')
        .eq('product_id', product.id)
        .maybeSingle();

      if (settingError) throw settingError;
      setShelfNumber(setting?.shelf_number || '');
      setInventoryMemo(setting?.memo || '');
    } catch (loadError) {
      // eslint-disable-next-line no-console
      console.error(loadError);
      setError(loadError?.message || '在庫情報の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      setLoading(true);
      try {
        const list = await loadProducts();
        if (!active) return;

        const first = filterProductId
          ? list.find((product) => String(product.id) === String(filterProductId))
          : null;

        if (first) setSelectedProduct(first);
      } catch (initialError) {
        if (!active) return;
        // eslint-disable-next-line no-console
        console.error(initialError);
        setError(initialError?.message || '商品一覧の取得に失敗しました');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [filterProductId, loadProducts]);

  useEffect(() => {
    loadProductContext(selectedProduct);
  }, [loadProductContext, selectedProduct]);

  const schedule = useMemo(
    () => normalizeSchedule(planItem?.delivery_schedule),
    [planItem?.delivery_schedule],
  );

  const completionMap = useMemo(
    () => new Map(completionRows.map((row) => [String(row.delivery_line_id), row])),
    [completionRows],
  );

  const printOrderQty = Math.max(0, safeInteger(planItem?.print_order_qty));
  const plannedQty = schedule.reduce((sum, row) => sum + row.qty, 0);
  const deliveredQty = completionRows.reduce(
    (sum, row) => sum + safeInteger(row.delivered_qty),
    0,
  );
  const rawStockQty = printOrderQty - deliveredQty;
  const stockQty = Math.max(0, rawStockQty);
  const allDelivered = printOrderQty > 0 && deliveredQty >= printOrderQty;

  const setDeliveryCompleted = async (scheduleRow, completed) => {
    if (!planItem?.id) return;

    const actionLabel = completed ? '納品済みにします' : '納品済みを解除します';
    if (
      !window.confirm(
        `No.${schedule.indexOf(scheduleRow) + 1}（${formatDateJa(scheduleRow.date)} / ${scheduleRow.qty.toLocaleString('ja-JP')}冊）を${actionLabel}。よろしいですか？`,
      )
    ) {
      return;
    }

    setBusyLineId(scheduleRow.id);
    clearMessages();

    try {
      const { error: rpcError } = await supabase.rpc(
        'set_order_plan_delivery_completion',
        {
          p_order_plan_item_id: planItem.id,
          p_delivery_line_id: scheduleRow.id,
          p_delivered_qty: scheduleRow.qty,
          p_completed: completed,
        },
      );

      if (rpcError) throw rpcError;
      await loadProductContext(selectedProduct);
      setSuccess(
        completed
          ? `No.${schedule.indexOf(scheduleRow) + 1}を納品済みにしました`
          : `No.${schedule.indexOf(scheduleRow) + 1}の納品済みを解除しました`,
      );
    } catch (updateError) {
      // eslint-disable-next-line no-console
      console.error(updateError);
      setError(updateError?.message || '納品状態の更新に失敗しました');
    } finally {
      setBusyLineId('');
    }
  };

  const saveSetting = async () => {
    if (!selectedProduct?.id) return;

    setSavingSetting(true);
    clearMessages();

    try {
      const { error: rpcError } = await supabase.rpc(
        'save_inventory_product_setting',
        {
          p_product_id: selectedProduct.id,
          p_shelf_number: String(shelfNumber || '').trim() || null,
          p_memo: String(inventoryMemo || '').trim() || null,
        },
      );

      if (rpcError) throw rpcError;
      await loadProductContext(selectedProduct);
      setSuccess('棚番号・在庫メモを保存しました');
    } catch (saveError) {
      // eslint-disable-next-line no-console
      console.error(saveError);
      setError(saveError?.message || '棚番号・在庫メモの保存に失敗しました');
    } finally {
      setSavingSetting(false);
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h4" fontWeight={900}>
            在庫管理（納品完了）
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
            計画書（発注）の印刷手配数から、日別に「納品済」とした数量だけを差し引いて現在在庫を表示します。
          </Typography>
        </Box>

        {error && <Alert severity="error">{error}</Alert>}
        {success && <Alert severity="success">{success}</Alert>}

        <Paper sx={{ p: 2 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
            <Autocomplete
              options={products}
              value={selectedProduct}
              onChange={(_event, value) => setSelectedProduct(value)}
              isOptionEqualToValue={(option, value) => option.id === value.id}
              getOptionLabel={(option) =>
                option ? `${option.product_code}　${option.name || ''}` : ''
              }
              renderInput={(inputParams) => (
                <TextField
                  {...inputParams}
                  label="計画書登録済み品番を検索・選択"
                  placeholder="例：99817-0126"
                />
              )}
              sx={{ flex: 1, minWidth: 320 }}
            />

            <Button
              variant="outlined"
              onClick={() => loadProductContext(selectedProduct)}
              disabled={!selectedProduct || loading}
            >
              再読み込み
            </Button>
          </Stack>
        </Paper>

        {loading && (
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={18} />
            <Typography variant="body2">読み込み中…</Typography>
          </Stack>
        )}

        {selectedProduct && !planItem && !loading && (
          <Alert severity="warning">
            この品番に計画書（発注）の明細がありません。
          </Alert>
        )}

        {selectedProduct && planItem && (
          <>
            <Paper sx={{ p: 2 }}>
              <Stack spacing={2}>
                <Stack
                  direction={{ xs: 'column', lg: 'row' }}
                  spacing={2}
                  alignItems={{ lg: 'center' }}
                >
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="h5" fontWeight={900}>
                      {selectedProduct.product_code}　{selectedProduct.name || ''}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {productTypeLabel(selectedProduct.product_type)} / 計画書：
                      {formatDateJa(planItem.order_plan?.plan_date)} / {factoryLabel(planItem.delivery_factory) || '工場未設定'}
                    </Typography>
                  </Box>

                  {allDelivered && <DoneStamp />}
                </Stack>

                {printOrderQty <= 0 && (
                  <Alert severity="warning">
                    印刷手配数が未入力です。計画書（発注）で印刷手配数を入力して一括保存してください。
                  </Alert>
                )}

                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: {
                      xs: '1fr',
                      sm: 'repeat(2, minmax(0, 1fr))',
                      lg: 'repeat(4, minmax(0, 1fr))',
                    },
                    gap: 1.5,
                  }}
                >
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="caption" color="text.secondary">
                      印刷手配数
                    </Typography>
                    <Typography variant="h4" fontWeight={900}>
                      {printOrderQty.toLocaleString('ja-JP')}冊
                    </Typography>
                  </Paper>

                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="caption" color="text.secondary">
                      納品済数量
                    </Typography>
                    <Typography variant="h4" fontWeight={900} color="success.light">
                      {deliveredQty.toLocaleString('ja-JP')}冊
                    </Typography>
                  </Paper>

                  <Paper
                    variant="outlined"
                    sx={{ p: 2, borderColor: allDelivered ? 'success.main' : 'primary.main' }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      現在在庫
                    </Typography>
                    <Typography variant="h3" fontWeight={1000} color={allDelivered ? 'success.light' : 'primary.light'}>
                      {stockQty.toLocaleString('ja-JP')}冊
                    </Typography>
                  </Paper>

                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="caption" color="text.secondary">
                      納品計画合計
                    </Typography>
                    <Typography variant="h4" fontWeight={900}>
                      {plannedQty.toLocaleString('ja-JP')}冊
                    </Typography>
                  </Paper>
                </Box>

                {rawStockQty < 0 && (
                  <Alert severity="warning">
                    納品済数量が印刷手配数を{Math.abs(rawStockQty).toLocaleString('ja-JP')}冊上回っています。対象行の数量または納品済状態を確認してください。
                  </Alert>
                )}
              </Stack>
            </Paper>

            <Paper sx={{ p: 2 }}>
              <Stack spacing={2}>
                <Typography variant="h6" fontWeight={900}>
                  納品計画（参照）
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  日別の「納品済」ボタンを押した行だけ在庫から差し引きます。押し間違えた場合は「納品済解除」で元に戻せます。
                </Typography>

                <Divider />

                {schedule.length === 0 ? (
                  <Alert severity="info">納品予定が登録されていません。</Alert>
                ) : (
                  <Stack spacing={1.25}>
                    {schedule.map((row, index) => {
                      const completion = completionMap.get(row.id);
                      const completed = Boolean(completion);
                      const lineBusy = busyLineId === row.id;

                      return (
                        <Paper
                          key={row.id}
                          variant="outlined"
                          sx={{
                            p: 1.5,
                            borderColor: completed ? 'success.main' : 'divider',
                            bgcolor: completed ? 'rgba(46, 125, 50, 0.07)' : 'background.paper',
                          }}
                        >
                          <Box
                            sx={{
                              display: 'grid',
                              gridTemplateColumns: {
                                xs: '1fr',
                                md: '80px minmax(160px, 1fr) minmax(130px, 0.6fr) minmax(170px, 1fr) auto',
                              },
                              gap: 1.25,
                              alignItems: 'center',
                            }}
                          >
                            <Typography fontWeight={900}>No.{index + 1}</Typography>

                            <Box>
                              <Typography variant="caption" color="text.secondary">
                                納品日
                              </Typography>
                              <Typography fontWeight={800}>{formatDateJa(row.date)}</Typography>
                            </Box>

                            <Box>
                              <Typography variant="caption" color="text.secondary">
                                納品数量
                              </Typography>
                              <Typography fontWeight={900}>{row.qty.toLocaleString('ja-JP')}冊</Typography>
                            </Box>

                            <Box>
                              {completed ? (
                                <>
                                  <Chip label="納品済" color="success" size="small" />
                                  <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5 }}>
                                    {completion.completed_at
                                      ? new Date(completion.completed_at).toLocaleString('ja-JP')
                                      : ''}
                                  </Typography>
                                </>
                              ) : (
                                <Chip label="未納品" variant="outlined" size="small" />
                              )}
                            </Box>

                            <Stack direction="row" spacing={0.8} flexWrap="wrap" useFlexGap>
                              <Button
                                size="small"
                                variant="contained"
                                color="success"
                                onClick={() => setDeliveryCompleted(row, true)}
                                disabled={completed || lineBusy}
                              >
                                {lineBusy ? '処理中…' : '納品済'}
                              </Button>
                              <Button
                                size="small"
                                variant="outlined"
                                color="warning"
                                onClick={() => setDeliveryCompleted(row, false)}
                                disabled={!completed || lineBusy}
                              >
                                納品済解除
                              </Button>
                            </Stack>
                          </Box>
                        </Paper>
                      );
                    })}
                  </Stack>
                )}
              </Stack>
            </Paper>

            <Paper sx={{ p: 2 }}>
              <Stack spacing={2}>
                <Typography variant="h6" fontWeight={900}>
                  棚番号・在庫メモ
                </Typography>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  <TextField
                    label="棚番号"
                    value={shelfNumber}
                    onChange={(event) => setShelfNumber(event.target.value)}
                    placeholder="例：A-03-2"
                    sx={{ minWidth: 260 }}
                  />
                  <TextField
                    label="在庫メモ（任意）"
                    value={inventoryMemo}
                    onChange={(event) => setInventoryMemo(event.target.value)}
                    placeholder="例：上段・右奥"
                    fullWidth
                  />
                  <Button
                    variant="contained"
                    onClick={saveSetting}
                    disabled={savingSetting}
                    sx={{ minWidth: 150 }}
                  >
                    {savingSetting ? '保存中…' : '保存'}
                  </Button>
                </Stack>
              </Stack>
            </Paper>
          </>
        )}
      </Stack>
    </Box>
  );
}
