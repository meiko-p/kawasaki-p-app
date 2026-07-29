import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient.jsx';

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';

import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import FactoryRoundedIcon from '@mui/icons-material/FactoryRounded';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';

const PRODUCT_TYPE_LABELS = {
  ENGINE: '小型エンジン',
  OM: 'O/M',
  OTHER: 'その他',
};

const WORK_TYPE_LABELS = {
  OUTSOURCE: '外注',
  INHOUSE: '社内',
};

const OUTSOURCE_STEPS = [
  { key: 'data_sent', label: 'データ送る' },
  { key: 'outsource_ordered', label: '外注手配' },
  { key: 'binding_ordered', label: '製本手配' },
];

const INHOUSE_STEPS = [
  { key: 'data_checked', label: 'データ確認' },
  { key: 'paper_ordered', label: '用紙手配' },
  { key: 'print_ordered', label: '印刷手配' },
  { key: 'binding_ordered', label: '製本手配' },
];

const EMPTY_CHECKLIST = {
  id: null,
  order_plan_item_id: null,
  product_id: null,
  work_type: '',
  data_sent: false,
  outsource_ordered: false,
  data_checked: false,
  paper_ordered: false,
  print_ordered: false,
  binding_ordered: false,
  is_completed: false,
  completed_at: null,
  completed_by: null,
  created_at: null,
  updated_at: null,
};

function productTypeLabel(value) {
  return PRODUCT_TYPE_LABELS[value] || String(value || '');
}

function factoryLabel(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  return digits ? `${Number(digits)}工場` : String(value || '');
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

function formatDateJa(value) {
  if (!value) return '-';
  const [year, month, day] = String(value).split('-');
  return year && month && day ? `${year}/${month}/${day}` : String(value);
}

function formatDateShort(value) {
  if (!value) return '日付未設定';
  const [, month, day] = String(value).split('-');
  return month && day ? `${Number(month)}月${Number(day)}日` : String(value);
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

  return source
    .map((row, index) => ({
      id: String(row?.id || `legacy-${index}`),
      date: String(row?.date || ''),
      qty: safeInteger(row?.qty ?? row?.quantity ?? 0),
    }))
    .filter((row) => row.date || row.qty > 0);
}

function normalizeChecklist(value, orderPlanItemId = null, productId = null) {
  return {
    ...EMPTY_CHECKLIST,
    ...(value || {}),
    order_plan_item_id:
      value?.order_plan_item_id || orderPlanItemId || null,
    product_id: value?.product_id || productId || null,
    work_type: value?.work_type || '',
    data_sent: Boolean(value?.data_sent),
    outsource_ordered: Boolean(value?.outsource_ordered),
    data_checked: Boolean(value?.data_checked),
    paper_ordered: Boolean(value?.paper_ordered),
    print_ordered: Boolean(value?.print_ordered),
    binding_ordered: Boolean(value?.binding_ordered),
    is_completed: Boolean(value?.is_completed),
  };
}

function requiredStepsFor(workType) {
  if (workType === 'OUTSOURCE') return OUTSOURCE_STEPS;
  if (workType === 'INHOUSE') return INHOUSE_STEPS;
  return [];
}

function progressInfo(checklist) {
  const requiredSteps = requiredStepsFor(checklist.work_type);
  const completedCount = requiredSteps.filter((step) => Boolean(checklist[step.key])).length;
  const totalCount = requiredSteps.length;
  const ready = totalCount > 0 && completedCount === totalCount;
  const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return {
    requiredSteps,
    completedCount,
    totalCount,
    ready,
    percent,
    remaining: Math.max(0, totalCount - completedCount),
  };
}

function checklistStatus(checklist) {
  if (checklist.is_completed) return 'COMPLETED';

  const progress = progressInfo(checklist);
  if (progress.ready) return 'READY';

  const hasProgress =
    Boolean(checklist.work_type) ||
    checklist.data_sent ||
    checklist.outsource_ordered ||
    checklist.data_checked ||
    checklist.paper_ordered ||
    checklist.print_ordered ||
    checklist.binding_ordered;

  return hasProgress ? 'IN_PROGRESS' : 'NOT_STARTED';
}

function statusLabel(status) {
  switch (status) {
    case 'COMPLETED':
      return '手配済';
    case 'READY':
      return '手配済に変更可能';
    case 'IN_PROGRESS':
      return '手配中';
    default:
      return '未着手';
  }
}

function statusColor(status) {
  switch (status) {
    case 'COMPLETED':
      return 'success';
    case 'READY':
      return 'info';
    case 'IN_PROGRESS':
      return 'warning';
    default:
      return 'default';
  }
}

function chunkArray(values, size = 100) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function fetchRowsInChunks({
  table,
  select,
  column,
  values,
  orderBy = '',
  ascending = false,
}) {
  const uniqueValues = [...new Set((values || []).filter(Boolean))];
  if (uniqueValues.length === 0) return [];

  const output = [];

  for (const chunk of chunkArray(uniqueValues, 100)) {
    let request = supabase.from(table).select(select).in(column, chunk);
    if (orderBy) {
      request = request.order(orderBy, { ascending });
    }

    const { data, error } = await request;
    if (error) throw error;
    output.push(...(data || []));
  }

  return output;
}

function detailSpecLabel(detail) {
  const parts = [];

  if (detail.detail_type) parts.push(detail.detail_type);
  if (detail.size) parts.push(detail.size);
  if (safeInteger(detail.pages) > 0) parts.push(`${safeInteger(detail.pages)}P`);

  if (String(detail.colors || '').trim()) {
    parts.push(
      `${detail.colors}色${detail.is_double_sided ? '・両面' : '・片面'}`,
    );
  }

  if (detail.paper_type) {
    const thickness = Number(detail.paper_thickness || 0);
    parts.push(
      `${detail.paper_type}${thickness > 0 ? ` ${thickness}K` : ''}`,
    );
  }

  if (detail.print_type === 'outsourced') {
    parts.push('外注印刷');
  } else if (detail.machine) {
    parts.push(detail.machine);
  }

  if (detail.binding_method) parts.push(detail.binding_method);

  return parts.filter(Boolean).join(' / ');
}

function buildSpecSearchText(details) {
  return (details || []).map(detailSpecLabel).join(' ');
}

function parseJsonObject(value) {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value;

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  return null;
}

function extractDempyoSpecText(dempyo) {
  if (!dempyo) return '';

  const source =
    parseJsonObject(dempyo.fields_json) ||
    parseJsonObject(dempyo.manual_fields) ||
    parseJsonObject(dempyo.form_data) ||
    parseJsonObject(dempyo.data_json) ||
    parseJsonObject(dempyo.payload) ||
    null;

  if (!source) return '';

  const values = [
    source.detailType || source.detail_type,
    source.size,
    source.quantity ? `数量${source.quantity}` : '',
    source.pages ? `${source.pages}P` : '',
    source.colorCount || source.colors,
    source.paper_general_type || source.paper_type,
    source.paper_cover_type,
    source.paper_body_type,
    source.bookMemo || source.binding_method,
    source.machine,
    source.note,
  ];

  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' / ');
}

function scheduleTotal(schedule) {
  return (schedule || []).reduce((sum, row) => sum + safeInteger(row.qty), 0);
}

export default function PrintOrderChecklist() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savingIds, setSavingIds] = useState(() => new Set());
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const setSaving = (itemId, saving) => {
    setSavingIds((previous) => {
      const next = new Set(previous);
      if (saving) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

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
            sort_order,
            created_at,
            updated_at,
            product:products (
              id,
              product_code,
              name,
              product_type,
              active,
              plan_registered
            ),
            order_plan:order_plans (
              id,
              plan_date,
              title,
              image_path,
              updated_at
            )
          `,
        )
        .order('updated_at', { ascending: false })
        .limit(500);

      if (itemError) throw itemError;

      const items = (itemRows || []).filter(
        (item) => item.product?.active !== false && item.product?.plan_registered !== false,
      );

      const itemIds = items.map((item) => item.id);
      const productIds = items.map((item) => item.product_id);

      const [checklistRows, estimateRows] = await Promise.all([
        fetchRowsInChunks({
          table: 'print_order_checklists',
          select: '*',
          column: 'order_plan_item_id',
          values: itemIds,
          orderBy: 'updated_at',
          ascending: false,
        }),
        fetchRowsInChunks({
          table: 'estimates',
          select:
            'id, title, product_id, order_plan_item_id, print_order_qty, delivery_factory, kawasaki_order_no, delivery_schedule, created_at, updated_at',
          column: 'product_id',
          values: productIds,
          orderBy: 'created_at',
          ascending: false,
        }),
      ]);

      const checklistMap = new Map(
        checklistRows.map((row) => [String(row.order_plan_item_id), row]),
      );

      const latestEstimateByItem = new Map();
      const latestEstimateByProduct = new Map();

      for (const estimate of estimateRows) {
        if (
          estimate.order_plan_item_id &&
          !latestEstimateByItem.has(String(estimate.order_plan_item_id))
        ) {
          latestEstimateByItem.set(String(estimate.order_plan_item_id), estimate);
        }

        if (
          estimate.product_id &&
          !latestEstimateByProduct.has(String(estimate.product_id))
        ) {
          latestEstimateByProduct.set(String(estimate.product_id), estimate);
        }
      }

      const chosenEstimates = items
        .map(
          (item) =>
            latestEstimateByItem.get(String(item.id)) ||
            latestEstimateByProduct.get(String(item.product_id)) ||
            null,
        )
        .filter(Boolean);

      const estimateIds = [...new Set(chosenEstimates.map((estimate) => estimate.id))];

      const detailRows = await fetchRowsInChunks({
        table: 'estimate_details',
        select:
          'id, estimate_id, detail_type, size, quantity, pages, colors, is_double_sided, binding_method, design_type, print_type, machine, paper_type, paper_thickness, needed_paper, created_at, updated_at',
        column: 'estimate_id',
        values: estimateIds,
        orderBy: 'created_at',
        ascending: true,
      });

      const detailsByEstimate = new Map();
      for (const detail of detailRows) {
        const key = String(detail.estimate_id);
        if (!detailsByEstimate.has(key)) detailsByEstimate.set(key, []);
        detailsByEstimate.get(key).push(detail);
      }

      let dempyoRows = [];
      try {
        dempyoRows = await fetchRowsInChunks({
          table: 'dempyos',
          select: '*',
          column: 'estimate_id',
          values: estimateIds,
          orderBy: 'updated_at',
          ascending: false,
        });
      } catch (dempyoError) {
        // 旧環境などで伝票テーブルの参照権限が無い場合も、
        // 見積仕様とチェックリスト本体は表示します。
        // eslint-disable-next-line no-console
        console.warn(dempyoError);
      }

      const dempyoMap = new Map();
      for (const dempyo of dempyoRows) {
        const key = String(dempyo.estimate_id);
        if (!dempyoMap.has(key)) dempyoMap.set(key, dempyo);
      }

      const combined = items.map((item) => {
        const latestEstimate =
          latestEstimateByItem.get(String(item.id)) ||
          latestEstimateByProduct.get(String(item.product_id)) ||
          null;

        const estimateDetails = latestEstimate
          ? detailsByEstimate.get(String(latestEstimate.id)) || []
          : [];

        return {
          ...item,
          schedule: normalizeSchedule(item.delivery_schedule),
          checklist: normalizeChecklist(
            checklistMap.get(String(item.id)),
            item.id,
            item.product_id,
          ),
          latestEstimate,
          estimateDetails,
          dempyo: latestEstimate
            ? dempyoMap.get(String(latestEstimate.id)) || null
            : null,
          dempyoSpecText: latestEstimate
            ? extractDempyoSpecText(
                dempyoMap.get(String(latestEstimate.id)) || null,
              )
            : '',
        };
      });

      combined.sort((left, right) => {
        const leftCompleted = left.checklist.is_completed ? 1 : 0;
        const rightCompleted = right.checklist.is_completed ? 1 : 0;
        if (leftCompleted !== rightCompleted) return leftCompleted - rightCompleted;

        const leftDate = left.order_plan?.plan_date || '';
        const rightDate = right.order_plan?.plan_date || '';
        const dateCompare = rightDate.localeCompare(leftDate);
        if (dateCompare !== 0) return dateCompare;

        return String(left.product?.product_code || '').localeCompare(
          String(right.product?.product_code || ''),
          'ja',
        );
      });

      setRows(combined);
    } catch (loadError) {
      // eslint-disable-next-line no-console
      console.error(loadError);
      setRows([]);
      setError(loadError?.message || '印刷手配チェックリストの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredRows = useMemo(() => {
    const keyword = query.trim().toLowerCase();

    return rows.filter((row) => {
      const status = checklistStatus(row.checklist);
      if (statusFilter !== 'ALL' && status !== statusFilter) return false;

      if (!keyword) return true;

      const searchText = [
        row.product?.product_code,
        row.product?.name,
        productTypeLabel(row.product?.product_type),
        row.kawasaki_order_no,
        factoryLabel(row.delivery_factory),
        row.order_plan?.plan_date,
        row.memo,
        buildSpecSearchText(row.estimateDetails),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return searchText.includes(keyword);
    });
  }, [query, rows, statusFilter]);

  const counts = useMemo(() => {
    const result = {
      ALL: rows.length,
      NOT_STARTED: 0,
      IN_PROGRESS: 0,
      READY: 0,
      COMPLETED: 0,
    };

    for (const row of rows) {
      result[checklistStatus(row.checklist)] += 1;
    }

    return result;
  }, [rows]);

  const persistChecklist = async (
    row,
    nextChecklist,
    successMessage = '',
  ) => {
    const previousChecklist = row.checklist;
    const optimistic = normalizeChecklist(
      nextChecklist,
      row.id,
      row.product_id,
    );

    setRows((previous) =>
      previous.map((item) =>
        item.id === row.id ? { ...item, checklist: optimistic } : item,
      ),
    );
    setSaving(row.id, true);
    setError('');
    setSuccess('');

    try {
      const { data, error: rpcError } = await supabase.rpc(
        'save_print_order_checklist',
        {
          p_order_plan_item_id: row.id,
          p_work_type: optimistic.work_type || null,
          p_data_sent: optimistic.data_sent,
          p_outsource_ordered: optimistic.outsource_ordered,
          p_data_checked: optimistic.data_checked,
          p_paper_ordered: optimistic.paper_ordered,
          p_print_ordered: optimistic.print_ordered,
          p_binding_ordered: optimistic.binding_ordered,
          p_is_completed: optimistic.is_completed,
        },
      );

      if (rpcError) throw rpcError;

      const saved = normalizeChecklist(data, row.id, row.product_id);
      setRows((previous) =>
        previous.map((item) =>
          item.id === row.id ? { ...item, checklist: saved } : item,
        ),
      );

      if (successMessage) setSuccess(successMessage);
    } catch (saveError) {
      // eslint-disable-next-line no-console
      console.error(saveError);
      setRows((previous) =>
        previous.map((item) =>
          item.id === row.id
            ? { ...item, checklist: previousChecklist }
            : item,
        ),
      );
      setError(saveError?.message || 'チェック内容の保存に失敗しました');
    } finally {
      setSaving(row.id, false);
    }
  };

  const changeWorkType = async (row, nextWorkType) => {
    if (!nextWorkType || nextWorkType === row.checklist.work_type) return;

    const current = row.checklist;
    const hasProgress =
      current.data_sent ||
      current.outsource_ordered ||
      current.data_checked ||
      current.paper_ordered ||
      current.print_ordered ||
      current.binding_ordered ||
      current.is_completed;

    if (
      hasProgress &&
      !window.confirm(
        `手配区分を「${WORK_TYPE_LABELS[nextWorkType]}」へ変更します。現在のチェックと手配済状態は初期化されます。よろしいですか？`,
      )
    ) {
      return;
    }

    await persistChecklist(
      row,
      {
        ...EMPTY_CHECKLIST,
        id: current.id,
        order_plan_item_id: row.id,
        product_id: row.product_id,
        work_type: nextWorkType,
      },
      `${row.product?.product_code || ''} の手配区分を「${WORK_TYPE_LABELS[nextWorkType]}」にしました`,
    );
  };

  const toggleStep = async (row, stepKey, checked) => {
    if (!row.checklist.work_type) return;

    await persistChecklist(row, {
      ...row.checklist,
      [stepKey]: checked,
      is_completed: false,
      completed_at: null,
      completed_by: null,
    });
  };

  const markCompleted = async (row) => {
    const progress = progressInfo(row.checklist);
    if (!progress.ready) {
      setError('必要なチェックをすべて完了してください');
      return;
    }

    if (
      !window.confirm(
        `品番「${row.product?.product_code || ''}」を手配済にします。よろしいですか？`,
      )
    ) {
      return;
    }

    await persistChecklist(
      row,
      { ...row.checklist, is_completed: true },
      `${row.product?.product_code || ''} を手配済にしました`,
    );
  };

  const releaseCompleted = async (row) => {
    if (
      !window.confirm(
        `品番「${row.product?.product_code || ''}」の手配済を解除します。チェック内容は残します。よろしいですか？`,
      )
    ) {
      return;
    }

    await persistChecklist(
      row,
      {
        ...row.checklist,
        is_completed: false,
        completed_at: null,
        completed_by: null,
      },
      `${row.product?.product_code || ''} の手配済を解除しました`,
    );
  };

  return (
    <Box sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h4" fontWeight={900}>
            印刷手配チェックリスト
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
            計画書の品番・印刷手配数・納品予定と、最新見積・伝票連携情報を確認しながら、外注または社内の手配工程を管理します。チェック内容は操作ごとに自動保存されます。
          </Typography>
        </Box>

        {error && <Alert severity="error">{error}</Alert>}
        {success && <Alert severity="success">{success}</Alert>}

        <Paper sx={{ p: 2 }}>
          <Stack spacing={1.5}>
            <Stack
              direction={{ xs: 'column', lg: 'row' }}
              spacing={1.5}
              alignItems={{ lg: 'center' }}
            >
              <TextField
                label="品番・商品名・注文番号・仕様で絞り込み"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                fullWidth
              />

              <FormControl sx={{ minWidth: 230 }}>
                <InputLabel id="print-check-status-filter-label">進捗状態</InputLabel>
                <Select
                  labelId="print-check-status-filter-label"
                  label="進捗状態"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <MenuItem value="ALL">全件（{counts.ALL}）</MenuItem>
                  <MenuItem value="NOT_STARTED">
                    未着手（{counts.NOT_STARTED}）
                  </MenuItem>
                  <MenuItem value="IN_PROGRESS">
                    手配中（{counts.IN_PROGRESS}）
                  </MenuItem>
                  <MenuItem value="READY">
                    手配済に変更可能（{counts.READY}）
                  </MenuItem>
                  <MenuItem value="COMPLETED">
                    手配済（{counts.COMPLETED}）
                  </MenuItem>
                </Select>
              </FormControl>

              <Button
                variant="outlined"
                startIcon={<RefreshRoundedIcon />}
                onClick={load}
                disabled={loading}
                sx={{ minWidth: 150 }}
              >
                再読み込み
              </Button>
            </Stack>

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip label={`全件 ${counts.ALL}`} variant="outlined" />
              <Chip
                label={`未着手 ${counts.NOT_STARTED}`}
                variant="outlined"
              />
              <Chip
                label={`手配中 ${counts.IN_PROGRESS}`}
                color="warning"
                variant="outlined"
              />
              <Chip
                label={`完了可能 ${counts.READY}`}
                color="info"
                variant="outlined"
              />
              <Chip
                label={`手配済 ${counts.COMPLETED}`}
                color="success"
                variant="outlined"
              />
            </Stack>
          </Stack>
        </Paper>

        {loading && (
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="center" sx={{ py: 4 }}>
            <CircularProgress size={22} />
            <Typography>計画書・見積・伝票情報を読み込んでいます…</Typography>
          </Stack>
        )}

        {!loading && filteredRows.length === 0 && (
          <Alert severity="info">
            条件に該当する計画書登録済み品番がありません。
          </Alert>
        )}

        {!loading && (
          <Stack spacing={1.5}>
            {filteredRows.map((row) => {
              const checklist = row.checklist;
              const progress = progressInfo(checklist);
              const status = checklistStatus(checklist);
              const rowSaving = savingIds.has(row.id);
              const schedule = row.schedule || [];
              const details = row.estimateDetails || [];
              const printOrderQty = safeInteger(row.print_order_qty);
              const totalDeliveryQty = scheduleTotal(schedule);

              return (
                <Paper
                  key={row.id}
                  sx={{
                    p: 2,
                    border: '1px solid',
                    borderColor: checklist.is_completed
                      ? 'success.main'
                      : progress.ready
                        ? 'info.main'
                        : 'divider',
                    bgcolor: checklist.is_completed
                      ? 'rgba(46, 125, 50, 0.055)'
                      : 'background.paper',
                  }}
                >
                  <Stack spacing={2}>
                    <Stack
                      direction={{ xs: 'column', lg: 'row' }}
                      spacing={1.5}
                      alignItems={{ lg: 'flex-start' }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                          <Typography variant="h6" fontWeight={1000}>
                            {row.product?.product_code || '-'}
                          </Typography>
                          <Typography variant="h6" fontWeight={800} color="text.secondary">
                            {row.product?.name || ''}
                          </Typography>
                          <Chip
                            size="small"
                            label={statusLabel(status)}
                            color={statusColor(status)}
                            variant={status === 'NOT_STARTED' ? 'outlined' : 'filled'}
                          />
                          {rowSaving && (
                            <Chip
                              size="small"
                              label="自動保存中…"
                              icon={<CircularProgress size={12} />}
                              variant="outlined"
                            />
                          )}
                        </Stack>

                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.6 }}>
                          {productTypeLabel(row.product?.product_type)} / 計画書：
                          {formatDateJa(row.order_plan?.plan_date)} /{' '}
                          {factoryLabel(row.delivery_factory) || '工場未設定'} / 注文番号：
                          {row.kawasaki_order_no || '未設定'}
                        </Typography>
                      </Box>

                      <Stack
                        direction="row"
                        spacing={1}
                        flexWrap="wrap"
                        useFlexGap
                        justifyContent={{ lg: 'flex-end' }}
                      >
                        <Paper variant="outlined" sx={{ px: 1.5, py: 1, minWidth: 145 }}>
                          <Typography variant="caption" color="text.secondary">
                            印刷手配数
                          </Typography>
                          <Typography variant="h6" fontWeight={1000}>
                            {printOrderQty.toLocaleString('ja-JP')}冊
                          </Typography>
                        </Paper>
                        <Paper variant="outlined" sx={{ px: 1.5, py: 1, minWidth: 145 }}>
                          <Typography variant="caption" color="text.secondary">
                            納品予定合計
                          </Typography>
                          <Typography variant="h6" fontWeight={900}>
                            {totalDeliveryQty.toLocaleString('ja-JP')}冊
                          </Typography>
                        </Paper>
                      </Stack>
                    </Stack>

                    {printOrderQty <= 0 && (
                      <Alert severity="warning">
                        印刷手配数が未入力です。計画書（発注）で入力して一括保存してください。
                      </Alert>
                    )}

                    <Box>
                      <Typography variant="caption" color="text.secondary" fontWeight={800}>
                        納品予定
                      </Typography>
                      <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                        {schedule.length === 0 ? (
                          <Chip size="small" label="納品予定未設定" variant="outlined" />
                        ) : (
                          schedule.map((delivery) => (
                            <Chip
                              key={delivery.id}
                              size="small"
                              color="error"
                              variant="outlined"
                              label={`${formatDateShort(delivery.date)} / ${delivery.qty.toLocaleString('ja-JP')}冊`}
                            />
                          ))
                        )}
                      </Stack>
                    </Box>

                    <Paper
                      variant="outlined"
                      sx={{
                        p: 1.5,
                        bgcolor: 'rgba(255,255,255,0.015)',
                      }}
                    >
                      <Stack spacing={1}>
                        <Stack
                          direction={{ xs: 'column', md: 'row' }}
                          spacing={1}
                          alignItems={{ md: 'center' }}
                        >
                          <Box sx={{ flex: 1 }}>
                            <Typography fontWeight={900}>
                              見積・伝票共通仕様
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              最新見積明細を共通仕様として表示し、伝票DBの登録状況を併記しています。
                            </Typography>
                          </Box>

                          {row.latestEstimate ? (
                            <Chip
                              size="small"
                              label={`最新見積：${new Date(row.latestEstimate.created_at).toLocaleString('ja-JP')}`}
                              variant="outlined"
                            />
                          ) : (
                            <Chip
                              size="small"
                              label="見積未登録"
                              color="warning"
                              variant="outlined"
                            />
                          )}

                          <Chip
                            size="small"
                            label={row.dempyo ? '伝票DB：登録済' : '伝票DB：未登録'}
                            color={row.dempyo ? 'success' : 'default'}
                            variant="outlined"
                          />
                        </Stack>

                        <Divider />

                        {details.length === 0 ? (
                          <Typography variant="body2" color="text.secondary">
                            見積仕様がまだ登録されていません。先に見積明細を作成してください。
                          </Typography>
                        ) : (
                          <Stack spacing={0.7}>
                            {details.map((detail, index) => (
                              <Box
                                key={detail.id || `${row.id}-detail-${index}`}
                                sx={{
                                  display: 'grid',
                                  gridTemplateColumns: { xs: '1fr', md: '90px minmax(0, 1fr)' },
                                  gap: 0.8,
                                  alignItems: 'center',
                                }}
                              >
                                <Chip
                                  size="small"
                                  label={detail.detail_type || `明細${index + 1}`}
                                  variant="outlined"
                                />
                                <Typography variant="body2" sx={{ lineHeight: 1.6 }}>
                                  {detailSpecLabel(detail) || '仕様未入力'}
                                </Typography>
                              </Box>
                            ))}
                          </Stack>
                        )}

                        {row.dempyo && (
                          <Stack spacing={0.35}>
                            <Typography variant="caption" color="text.secondary">
                              伝票登録：
                              {row.dempyo.updated_at
                                ? new Date(row.dempyo.updated_at).toLocaleString('ja-JP')
                                : '-'}
                              {safeInteger(row.dempyo.received_qty) > 0
                                ? ` / 入庫数量 ${safeInteger(row.dempyo.received_qty).toLocaleString('ja-JP')}冊`
                                : ''}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {row.dempyoSpecText
                                ? `伝票抽出：${row.dempyoSpecText}`
                                : '伝票DBに詳細仕様が保存されていないため、上記の見積共通仕様を表示しています。'}
                            </Typography>
                          </Stack>
                        )}
                      </Stack>
                    </Paper>

                    <Divider />

                    <Box>
                      <Stack
                        direction={{ xs: 'column', md: 'row' }}
                        spacing={1.5}
                        alignItems={{ md: 'center' }}
                      >
                        <Box sx={{ flex: 1 }}>
                          <Typography fontWeight={900}>手配区分</Typography>
                          <Typography variant="caption" color="text.secondary">
                            最初に「外注」または「社内」を選択してください。
                          </Typography>
                        </Box>

                        <ToggleButtonGroup
                          exclusive
                          color="primary"
                          value={checklist.work_type || null}
                          onChange={(_event, value) => changeWorkType(row, value)}
                          disabled={rowSaving}
                          aria-label="手配区分"
                        >
                          <ToggleButton value="OUTSOURCE" sx={{ minWidth: 130 }}>
                            <PublicRoundedIcon sx={{ mr: 0.8 }} />
                            外注
                          </ToggleButton>
                          <ToggleButton value="INHOUSE" sx={{ minWidth: 130 }}>
                            <FactoryRoundedIcon sx={{ mr: 0.8 }} />
                            社内
                          </ToggleButton>
                        </ToggleButtonGroup>
                      </Stack>
                    </Box>

                    {!checklist.work_type ? (
                      <Alert severity="info">
                        外注または社内を選択すると、必要なチェック項目が表示されます。
                      </Alert>
                    ) : (
                      <>
                        <Box
                          sx={{
                            display: 'grid',
                            gridTemplateColumns: {
                              xs: '1fr',
                              sm: 'repeat(2, minmax(0, 1fr))',
                              lg: `repeat(${Math.min(progress.totalCount, 4)}, minmax(0, 1fr))`,
                            },
                            gap: 1,
                          }}
                        >
                          {progress.requiredSteps.map((step, index) => {
                            const checked = Boolean(checklist[step.key]);

                            return (
                              <Paper
                                key={step.key}
                                variant="outlined"
                                sx={{
                                  p: 1,
                                  borderColor: checked ? 'success.main' : 'divider',
                                  bgcolor: checked
                                    ? 'rgba(46, 125, 50, 0.065)'
                                    : 'background.paper',
                                }}
                              >
                                <FormControlLabel
                                  sx={{ m: 0, width: '100%' }}
                                  control={
                                    <Checkbox
                                      checked={checked}
                                      onChange={(event) =>
                                        toggleStep(row, step.key, event.target.checked)
                                      }
                                      disabled={rowSaving}
                                      color="success"
                                    />
                                  }
                                  label={
                                    <Stack direction="row" spacing={0.7} alignItems="center">
                                      <Chip
                                        size="small"
                                        label={index + 1}
                                        color={checked ? 'success' : 'default'}
                                        variant={checked ? 'filled' : 'outlined'}
                                      />
                                      <Typography fontWeight={checked ? 900 : 700}>
                                        {step.label}
                                      </Typography>
                                    </Stack>
                                  }
                                />
                              </Paper>
                            );
                          })}
                        </Box>

                        <Stack spacing={0.8}>
                          <Stack direction="row" justifyContent="space-between" alignItems="center">
                            <Typography variant="body2" fontWeight={800}>
                              進捗：{progress.completedCount}/{progress.totalCount}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {progress.ready
                                ? '必要項目がすべて完了しました'
                                : `残り${progress.remaining}項目`}
                            </Typography>
                          </Stack>
                          <LinearProgress
                            variant="determinate"
                            value={progress.percent}
                            color={progress.ready ? 'success' : 'primary'}
                            sx={{ height: 9, borderRadius: 999 }}
                          />
                        </Stack>

                        {progress.ready || checklist.is_completed ? (
                          <Stack
                            direction={{ xs: 'column', sm: 'row' }}
                            spacing={1}
                            alignItems={{ sm: 'center' }}
                          >
                            <Button
                              variant="contained"
                              color="success"
                              startIcon={<CheckCircleRoundedIcon />}
                              onClick={() => markCompleted(row)}
                              disabled={checklist.is_completed || rowSaving}
                            >
                              手配済
                            </Button>
                            <Button
                              variant="outlined"
                              color="warning"
                              startIcon={<RestartAltRoundedIcon />}
                              onClick={() => releaseCompleted(row)}
                              disabled={!checklist.is_completed || rowSaving}
                            >
                              手配済解除
                            </Button>

                            {checklist.is_completed && (
                              <Typography variant="body2" color="success.light" fontWeight={900}>
                                {checklist.completed_at
                                  ? `${new Date(checklist.completed_at).toLocaleString('ja-JP')} に手配済登録`
                                  : '手配済登録'}
                              </Typography>
                            )}
                          </Stack>
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            必要なチェックがすべて完了すると、「手配済」と「手配済解除」のボタンが表示されます。
                          </Typography>
                        )}
                      </>
                    )}
                  </Stack>
                </Paper>
              );
            })}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
