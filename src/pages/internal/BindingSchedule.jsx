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
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

const EVENT_TYPE_OPTIONS = [
  { value: 'MATTE_PP', label: 'マットPP' },
  { value: 'PERFECT_BINDING', label: '無線綴じ' },
  { value: 'DOUBLE_FOLD', label: '2回折り' },
];

const EVENT_COLORS = {
  DELIVERY: {
    background: 'rgba(239, 83, 80, 0.18)',
    border: '#ef5350',
    text: '#ff8a80',
  },
  MATTE_PP: {
    background: 'rgba(66, 165, 245, 0.18)',
    border: '#42a5f5',
    text: '#90caf9',
  },
  PERFECT_BINDING: {
    background: 'rgba(255, 193, 7, 0.20)',
    border: '#ffc107',
    text: '#ffe082',
  },
  DOUBLE_FOLD: {
    background: 'rgba(102, 187, 106, 0.18)',
    border: '#66bb6a',
    text: '#a5d6a7',
  },
};

const EMPTY_EDITOR = {
  id: null,
  productId: '',
  eventDate: '',
  eventType: 'MATTE_PP',
  quantity: '',
  note: '',
  sourceType: 'binding',
  sourcePlanItemId: null,
  manualOverride: false,
};

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, count) {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function toDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function monthInputValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function parseMonthInput(value) {
  const [year, month] = String(value || '').split('-').map(Number);
  if (!year || !month) return startOfMonth(new Date());
  return new Date(year, month - 1, 1);
}

function formatMonthTitle(date) {
  return `${date.getFullYear()}年 ${date.getMonth() + 1}月`;
}

function formatDateJa(value) {
  if (!value) return '';
  const [year, month, day] = String(value).split('-');
  if (!year || !month || !day) return String(value);
  return `${year}/${month}/${day}`;
}

function eventTypeLabel(value) {
  if (value === 'DELIVERY') return '納品日';
  return EVENT_TYPE_OPTIONS.find((option) => option.value === value)?.label || value;
}

function safeInteger(value) {
  const normalized = String(value ?? '').replace(/,/g, '').replace(/[^\d-]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

function buildMonthCells(monthDate) {
  const first = startOfMonth(monthDate);
  const firstDayIndex = first.getDay();
  const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - firstDayIndex);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
    return {
      date,
      dateString: toDateString(date),
      day: date.getDate(),
      inCurrentMonth: date.getMonth() === monthDate.getMonth(),
      isToday: toDateString(date) === toDateString(new Date()),
    };
  });
}

function CalendarMonth({ monthDate, eventsByDate, onDayClick, onEventClick }) {
  const cells = useMemo(() => buildMonthCells(monthDate), [monthDate]);
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];

  return (
    <Paper
      variant="outlined"
      sx={{
        minWidth: 510,
        overflow: 'hidden',
        bgcolor: 'background.paper',
      }}
    >
      <Box sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="h6" fontWeight={900} textAlign="center">
          {formatMonthTitle(monthDate)}
        </Typography>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
        {weekdays.map((weekday, index) => (
          <Box
            key={weekday}
            sx={{
              py: 0.75,
              textAlign: 'center',
              fontSize: 12,
              fontWeight: 900,
              color:
                index === 0
                  ? 'error.light'
                  : index === 6
                    ? 'primary.light'
                    : 'text.secondary',
              borderBottom: '1px solid',
              borderColor: 'divider',
            }}
          >
            {weekday}
          </Box>
        ))}

        {cells.map((cell) => {
          const dayEvents = eventsByDate[cell.dateString] || [];

          return (
            <Box
              key={cell.dateString}
              onDoubleClick={() => onDayClick(cell.dateString)}
              sx={{
                minHeight: 112,
                p: 0.6,
                borderRight: '1px solid',
                borderBottom: '1px solid',
                borderColor: 'divider',
                bgcolor: cell.inCurrentMonth
                  ? cell.isToday
                    ? 'rgba(77, 208, 225, 0.06)'
                    : 'transparent'
                  : 'rgba(255,255,255,0.018)',
                opacity: cell.inCurrentMonth ? 1 : 0.45,
                cursor: 'default',
              }}
            >
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography
                  variant="caption"
                  fontWeight={cell.isToday ? 900 : 700}
                  sx={{
                    color:
                      cell.date.getDay() === 0
                        ? 'error.light'
                        : cell.date.getDay() === 6
                          ? 'primary.light'
                          : 'text.secondary',
                  }}
                >
                  {cell.day}
                </Typography>

                {cell.inCurrentMonth && (
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => onDayClick(cell.dateString)}
                    sx={{ minWidth: 24, p: 0, fontSize: 15 }}
                    title="この日に製本予定を追加"
                  >
                    ＋
                  </Button>
                )}
              </Stack>

              <Stack spacing={0.45} sx={{ mt: 0.4 }}>
                {dayEvents.map((event) => {
                  const color = EVENT_COLORS[event.event_type] || EVENT_COLORS.MATTE_PP;
                  const code = event.product?.product_code || '';
                  const quantity = Number(event.quantity || 0);

                  return (
                    <Box
                      key={event.id}
                      onClick={() => onEventClick(event)}
                      sx={{
                        px: 0.7,
                        py: 0.45,
                        borderRadius: 1,
                        borderLeft: `4px solid ${color.border}`,
                        bgcolor: color.background,
                        color: color.text,
                        cursor: 'pointer',
                        transition: 'filter 120ms ease',
                        '&:hover': { filter: 'brightness(1.18)' },
                      }}
                    >
                      <Typography
                        sx={{
                          fontSize: 10.5,
                          lineHeight: 1.25,
                          fontWeight: 900,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {eventTypeLabel(event.event_type)}　{code}
                      </Typography>
                      {(quantity > 0 || event.note) && (
                        <Typography
                          sx={{
                            mt: 0.2,
                            fontSize: 9.5,
                            lineHeight: 1.2,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {quantity > 0 ? `${quantity}冊` : ''}
                          {quantity > 0 && event.note ? ' / ' : ''}
                          {event.note || ''}
                        </Typography>
                      )}
                    </Box>
                  );
                })}
              </Stack>
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
}

export default function BindingSchedule() {
  const [params] = useSearchParams();
  const filterProductId = params.get('product_id') || '';
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [startMonthValue, setStartMonthValue] = useState(monthInputValue(new Date()));
  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [events, setEvents] = useState([]);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editor, setEditor] = useState(EMPTY_EDITOR);

  const startMonth = useMemo(() => parseMonthInput(startMonthValue), [startMonthValue]);
  const months = useMemo(
    () => [startMonth, addMonths(startMonth, 1), addMonths(startMonth, 2)],
    [startMonth],
  );

  const rangeStart = useMemo(() => toDateString(startOfMonth(startMonth)), [startMonth]);
  const rangeEnd = useMemo(() => toDateString(addMonths(startMonth, 3)), [startMonth]);

  const eventsByDate = useMemo(() => {
    const map = {};
    events.forEach((event) => {
      if (!map[event.event_date]) map[event.event_date] = [];
      map[event.event_date].push(event);
    });

    Object.values(map).forEach((rows) => {
      rows.sort((a, b) => {
        const rank = {
          DELIVERY: 0,
          PERFECT_BINDING: 1,
          MATTE_PP: 2,
          DOUBLE_FOLD: 3,
        };
        return (rank[a.event_type] ?? 9) - (rank[b.event_type] ?? 9);
      });
    });

    return map;
  }, [events]);

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

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    clearMessages();

    try {
      let query = supabase
        .from('production_schedule_events')
        .select(
          `
            id,
            product_id,
            source_type,
            source_plan_item_id,
            source_line_id,
            event_date,
            event_type,
            quantity,
            note,
            manual_override,
            hidden,
            created_at,
            updated_at,
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
        .gte('event_date', rangeStart)
        .lt('event_date', rangeEnd)
        .eq('hidden', false)
        .order('event_date', { ascending: true })
        .order('created_at', { ascending: true });

      if (selectedProduct?.id) {
        query = query.eq('product_id', selectedProduct.id);
      }

      const { data, error: fetchError } = await query;
      if (fetchError) throw fetchError;
      setEvents(data || []);
    } catch (fetchError) {
      // eslint-disable-next-line no-console
      console.error(fetchError);
      setError(fetchError?.message || '製本スケジュールの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [rangeEnd, rangeStart, selectedProduct?.id]);

  useEffect(() => {
    (async () => {
      try {
        await fetchProducts();
      } catch (initialError) {
        // eslint-disable-next-line no-console
        console.error(initialError);
        setError(initialError?.message || '品番一覧の取得に失敗しました');
      }
    })();
  }, [fetchProducts]);

  useEffect(() => {
    if (!filterProductId || products.length === 0 || selectedProduct?.id) return;
    const matched = products.find((product) => String(product.id) === String(filterProductId));
    if (matched) setSelectedProduct(matched);
  }, [filterProductId, products, selectedProduct?.id]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    const channel = supabase
      .channel('production-schedule-live')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'production_schedule_events',
        },
        () => {
          fetchEvents();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchEvents]);

  const openNewEditor = (dateString = '') => {
    clearMessages();
    setEditor({
      ...EMPTY_EDITOR,
      productId: selectedProduct?.id || '',
      eventDate: dateString,
    });
    setEditorOpen(true);
  };

  const openExistingEditor = (event) => {
    clearMessages();
    setEditor({
      id: event.id,
      productId: event.product_id || '',
      eventDate: event.event_date || '',
      eventType: event.event_type || 'MATTE_PP',
      quantity: event.quantity ?? '',
      note: event.note || '',
      sourceType: event.source_type || 'binding',
      sourcePlanItemId: event.source_plan_item_id || null,
      manualOverride: Boolean(event.manual_override),
    });
    setEditorOpen(true);
  };

  const saveEditor = async () => {
    if (!editor.productId) {
      setError('品番を選択してください');
      return;
    }
    if (!editor.eventDate) {
      setError('日付を入力してください');
      return;
    }

    setSaving(true);
    clearMessages();

    try {
      if (editor.id) {
        const patch = {
          event_date: editor.eventDate,
          quantity: safeInteger(editor.quantity) || null,
          note: String(editor.note || '').trim() || null,
          hidden: false,
        };

        if (editor.sourceType === 'plan_delivery') {
          patch.manual_override = true;
          patch.event_type = 'DELIVERY';
        } else {
          patch.event_type = editor.eventType;
          patch.product_id = editor.productId;
        }

        const { error: updateError } = await supabase
          .from('production_schedule_events')
          .update(patch)
          .eq('id', editor.id);

        if (updateError) throw updateError;
        setSuccess('スケジュールを更新しました');
      } else {
        const { error: insertError } = await supabase
          .from('production_schedule_events')
          .insert({
            product_id: editor.productId,
            source_type: 'binding',
            event_date: editor.eventDate,
            event_type: editor.eventType,
            quantity: safeInteger(editor.quantity) || null,
            note: String(editor.note || '').trim() || null,
            manual_override: false,
            hidden: false,
          });

        if (insertError) throw insertError;
        setSuccess('製本予定を追加しました');
      }

      setEditorOpen(false);
      await fetchEvents();
    } catch (saveError) {
      // eslint-disable-next-line no-console
      console.error(saveError);
      setError(saveError?.message || 'スケジュールの保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const deleteEditorEvent = async () => {
    if (!editor.id) return;

    const label = eventTypeLabel(editor.eventType);
    if (!window.confirm(`${label}の予定を削除します。よろしいですか？`)) return;

    setSaving(true);
    clearMessages();

    try {
      if (editor.sourceType === 'plan_delivery') {
        const { error: hideError } = await supabase
          .from('production_schedule_events')
          .update({ hidden: true, manual_override: true })
          .eq('id', editor.id);

        if (hideError) throw hideError;
      } else {
        const { error: deleteError } = await supabase
          .from('production_schedule_events')
          .delete()
          .eq('id', editor.id);

        if (deleteError) throw deleteError;
      }

      setEditorOpen(false);
      await fetchEvents();
      setSuccess('予定を削除しました');
    } catch (deleteError) {
      // eslint-disable-next-line no-console
      console.error(deleteError);
      setError(deleteError?.message || '予定の削除に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const resyncSelectedProduct = async () => {
    if (!selectedProduct?.id) {
      setError('計画書から再同期する品番を選択してください');
      return;
    }

    if (
      !window.confirm(
        '選択品番の納品日を計画書（発注）の内容に戻します。スケジュール画面で移動・非表示にした納品日も初期化されます。よろしいですか？',
      )
    ) {
      return;
    }

    setLoading(true);
    clearMessages();

    try {
      const { data: planItems, error: itemError } = await supabase
        .from('order_plan_items')
        .select('id')
        .eq('product_id', selectedProduct.id);

      if (itemError) throw itemError;

      for (const item of planItems || []) {
        const { error: rpcError } = await supabase.rpc(
          'reset_order_plan_delivery_events',
          { p_item_id: item.id },
        );
        if (rpcError) throw rpcError;
      }

      await fetchEvents();
      setSuccess('計画書（発注）の納品予定から再同期しました');
    } catch (syncError) {
      // eslint-disable-next-line no-console
      console.error(syncError);
      setError(syncError?.message || '計画書からの再同期に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const selectedEditorProduct = useMemo(
    () => products.find((product) => product.id === editor.productId) || null,
    [editor.productId, products],
  );

  return (
    <Box sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h4" fontWeight={900}>
            製本スケジュール（3カ月）
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
            計画書（発注）の納品日は自動表示されます。納品日は移動・非表示にでき、製本予定は品番ごとに追加できます。
          </Typography>
        </Box>

        {error && <Alert severity="error">{error}</Alert>}
        {success && <Alert severity="success">{success}</Alert>}

        <Paper sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Stack
              direction={{ xs: 'column', lg: 'row' }}
              spacing={2}
              alignItems={{ lg: 'center' }}
            >
              <TextField
                type="month"
                label="表示開始月"
                value={startMonthValue}
                onChange={(event) => setStartMonthValue(event.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ minWidth: 220 }}
              />

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
                    label="品番で絞り込み（未選択なら全品番）"
                  />
                )}
                sx={{ flex: 1, minWidth: 320 }}
              />

              <Button variant="contained" onClick={() => openNewEditor('')}>
                製本予定を追加
              </Button>

              <Button
                variant="outlined"
                onClick={resyncSelectedProduct}
                disabled={!selectedProduct || loading}
              >
                計画書から再同期
              </Button>

              <Button variant="outlined" onClick={fetchEvents} disabled={loading}>
                再読み込み
              </Button>
            </Stack>

            <Divider />

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip
                label="納品日"
                sx={{
                  color: EVENT_COLORS.DELIVERY.text,
                  bgcolor: EVENT_COLORS.DELIVERY.background,
                  border: `1px solid ${EVENT_COLORS.DELIVERY.border}`,
                }}
              />
              <Chip
                label="マットPP"
                sx={{
                  color: EVENT_COLORS.MATTE_PP.text,
                  bgcolor: EVENT_COLORS.MATTE_PP.background,
                  border: `1px solid ${EVENT_COLORS.MATTE_PP.border}`,
                }}
              />
              <Chip
                label="無線綴じ（製本会社共有）"
                sx={{
                  color: EVENT_COLORS.PERFECT_BINDING.text,
                  bgcolor: EVENT_COLORS.PERFECT_BINDING.background,
                  border: `1px solid ${EVENT_COLORS.PERFECT_BINDING.border}`,
                  fontWeight: 900,
                }}
              />
              <Chip
                label="2回折り"
                sx={{
                  color: EVENT_COLORS.DOUBLE_FOLD.text,
                  bgcolor: EVENT_COLORS.DOUBLE_FOLD.background,
                  border: `1px solid ${EVENT_COLORS.DOUBLE_FOLD.border}`,
                }}
              />
            </Stack>

            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              日付枠の「＋」または日付枠をダブルクリックすると、その日に製本予定を追加できます。予定をクリックすると移動・修正・削除できます。
            </Typography>
          </Stack>
        </Paper>

        {loading && (
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={18} />
            <Typography variant="body2">スケジュールを更新中…</Typography>
          </Stack>
        )}

        <Box sx={{ overflowX: 'auto', pb: 1 }}>
          <Stack direction="row" spacing={2} alignItems="flex-start">
            {months.map((month) => (
              <CalendarMonth
                key={monthInputValue(month)}
                monthDate={month}
                eventsByDate={eventsByDate}
                onDayClick={openNewEditor}
                onEventClick={openExistingEditor}
              />
            ))}
          </Stack>
        </Box>

        <Alert severity="info">
          将来のFlutter閲覧・修正アプリは、Supabaseの
          <strong> production_schedule_events </strong>
          テーブルを直接参照・更新します。Realtimeを有効にしているため、Flutter側の修正はこのReact画面にも自動反映できます。
        </Alert>
      </Stack>

      <Dialog open={editorOpen} onClose={() => setEditorOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>
          {editor.id
            ? editor.sourceType === 'plan_delivery'
              ? '納品日を移動・修正'
              : '製本予定を修正'
            : '製本予定を追加'}
        </DialogTitle>

        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Autocomplete
              options={products}
              value={selectedEditorProduct}
              onChange={(_event, value) =>
                setEditor((previous) => ({
                  ...previous,
                  productId: value?.id || '',
                }))
              }
              disabled={editor.sourceType === 'plan_delivery'}
              isOptionEqualToValue={(option, value) => option.id === value.id}
              getOptionLabel={(option) =>
                option ? `${option.product_code}　${option.name || ''}` : ''
              }
              renderInput={(params) => (
                <TextField {...params} label="品番" />
              )}
            />

            <TextField
              type="date"
              label="日付"
              value={editor.eventDate}
              onChange={(event) =>
                setEditor((previous) => ({
                  ...previous,
                  eventDate: event.target.value,
                }))
              }
              InputLabelProps={{ shrink: true }}
            />

            {editor.sourceType === 'plan_delivery' ? (
              <Alert severity="warning">
                計画書由来の納品日です。この画面で日付を変えると「手動変更」となり、計画書の通常保存では上書きされません。「計画書から再同期」で元に戻せます。
              </Alert>
            ) : (
              <FormControl>
                <InputLabel id="binding-type-label">製本内容</InputLabel>
                <Select
                  labelId="binding-type-label"
                  label="製本内容"
                  value={editor.eventType}
                  onChange={(event) =>
                    setEditor((previous) => ({
                      ...previous,
                      eventType: event.target.value,
                    }))
                  }
                >
                  {EVENT_TYPE_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            <TextField
              label="数量（任意）"
              value={editor.quantity}
              onChange={(event) =>
                setEditor((previous) => ({
                  ...previous,
                  quantity: event.target.value,
                }))
              }
              placeholder="例：500"
            />

            <TextField
              label="メモ（任意）"
              value={editor.note}
              onChange={(event) =>
                setEditor((previous) => ({
                  ...previous,
                  note: event.target.value,
                }))
              }
              multiline
              minRows={3}
            />

            {editor.id && (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                現在の日付：{formatDateJa(editor.eventDate)} / 種類：
                {eventTypeLabel(editor.eventType)}
              </Typography>
            )}
          </Stack>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2 }}>
          {editor.id && (
            <Button color="error" onClick={deleteEditorEvent} disabled={saving}>
              削除
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setEditorOpen(false)}>キャンセル</Button>
          <Button variant="contained" onClick={saveEditor} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
