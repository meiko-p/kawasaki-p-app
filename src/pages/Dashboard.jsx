import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';

import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded';
import LocalShippingRoundedIcon from '@mui/icons-material/LocalShippingRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';

const SHARED_CARDS = {
  orderPlans: {
    title: '計画書（発注）【スタート】',
    description:
      '計画書写真、品番、印刷手配数、納品工場、注文番号、納品予定を登録します。見積数量と在庫管理の起点です。',
    path: '/order-plans',
    start: true,
  },
  packages: {
    title: '梱包登録',
    description:
      '計画書登録済み品番だけを対象に、納入荷姿申請書・写真・梱包サイズ・ロットを登録します。',
    path: '/packages',
  },
  prices: {
    title: '単価登録【数量・商品別単価】',
    description:
      '計画書登録済み品番について、数量と商品別単価を一覧で登録・更新します。',
    path: '/products',
  },
  search: {
    title: '商品番号検索',
    description:
      '計画書登録済みの商品番号から、計画・見積・梱包・手配チェック・ラベル・在庫・単価へ移動します。',
    path: '/search',
  },
};

const STAFF_CARDS = {
  estimates: {
    title: '見積作成',
    description:
      '計画書（発注）の印刷手配数を数量初期値として引き継ぎ、見積計算・PDF出力を行います。',
    path: '/estimates',
  },
  dempyo: {
    title: '社内伝票（PDF）',
    description:
      '手順票・工程表・売上伝票・得意先元帳を作成します。',
    path: '/dempyo',
  },
  printChecklist: {
    title: '印刷手配チェックリスト',
    description:
      '計画書・見積仕様を確認しながら、外注または社内の手配工程をチェックし、手配済状態を管理します。',
    path: '/print-order-checklist',
  },
  labels: {
    title: 'ラベル【田中さん共有】',
    description:
      '計画書登録済み品番の納品予定・ロット・包数を整理し、PDF出力します。',
    path: '/labels',
  },
  inventory: {
    title: '在庫管理（納品完了）',
    description:
      '計画書の印刷手配数から、納品済みにした日別数量を差し引き、現在在庫と完了状態を管理します。',
    path: '/inventory',
  },
  binding: {
    title: '製本スケジュール（3カ月）',
    description:
      '納品日を自動反映し、マットPP・無線綴じ・2回折りの日程を3カ月同時表示で管理します。',
    path: '/binding-schedule',
  },
};

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

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

function toLocalIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date, amount) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + amount);
  return next;
}

function parseLocalDate(value) {
  const [year, month, day] = String(value || '')
    .split('-')
    .map((part) => Number(part));

  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function formatMonthDay(value) {
  const date = parseLocalDate(value);
  if (!date) return String(value || '');
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatDateWithWeekday(value) {
  const date = parseLocalDate(value);
  if (!date) return String(value || '');
  return `${date.getMonth() + 1}月${date.getDate()}日（${WEEKDAY_LABELS[date.getDay()]}）`;
}

function factoryLabel(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  return digits ? `${Number(digits)}工場` : String(value || '');
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


function chunkArray(values, size = 100) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function fetchCompletionRows(itemIds) {
  const output = [];

  for (const chunk of chunkArray([...new Set(itemIds.filter(Boolean))], 100)) {
    const { data, error } = await supabase
      .from('order_plan_delivery_completions')
      .select('order_plan_item_id, delivery_line_id, delivered_qty, completed_at')
      .in('order_plan_item_id', chunk);

    if (error) throw error;
    output.push(...(data || []));
  }

  return output;
}

function DashboardCard({ card, onOpen }) {
  return (
    <Paper
      sx={{
        p: 2.5,
        minHeight: 190,
        display: 'flex',
        flexDirection: 'column',
        border: card.start
          ? '1px solid rgba(77, 208, 225, 0.55)'
          : '1px solid rgba(255,255,255,0.08)',
        boxShadow: card.start
          ? '0 0 0 1px rgba(77, 208, 225, 0.12), 0 18px 50px rgba(0,0,0,0.18)'
          : undefined,
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="h6" fontWeight={900} sx={{ flex: 1 }}>
          {card.title}
        </Typography>
        {card.start && <Chip label="START" color="primary" size="small" />}
      </Stack>

      <Typography
        variant="body2"
        sx={{ mt: 1.2, color: 'text.secondary', lineHeight: 1.75, flex: 1 }}
      >
        {card.description}
      </Typography>

      <Button
        variant={card.start ? 'contained' : 'outlined'}
        onClick={() => onOpen(card.path)}
        sx={{ mt: 2 }}
      >
        開く
      </Button>
    </Paper>
  );
}

function DeliverySummaryButton({ loading, todayRows, nextRow, onOpen }) {
  const firstToday = todayRows[0] || null;

  return (
    <Paper
      component="button"
      type="button"
      onClick={onOpen}
      sx={{
        width: { xs: '100%', lg: 390 },
        minHeight: 112,
        p: 1.6,
        border: '1px solid rgba(77, 208, 225, 0.38)',
        bgcolor: 'rgba(77, 208, 225, 0.045)',
        color: 'text.primary',
        textAlign: 'left',
        cursor: 'pointer',
        display: 'block',
        font: 'inherit',
        transition: 'border-color 120ms ease, background-color 120ms ease',
        '&:hover': {
          borderColor: 'primary.main',
          bgcolor: 'rgba(77, 208, 225, 0.08)',
        },
        '&:focus-visible': {
          outline: '3px solid rgba(77, 208, 225, 0.35)',
          outlineOffset: 2,
        },
      }}
      aria-label="本日の納品と2週間分の納品スケジュールを開く"
    >
      <Stack direction="row" spacing={1.2} alignItems="center">
        <Box
          sx={{
            width: 42,
            height: 42,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'rgba(77, 208, 225, 0.12)',
            color: 'primary.light',
            flexShrink: 0,
          }}
        >
          <LocalShippingRoundedIcon />
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography fontWeight={900}>本日の納品</Typography>

          {loading ? (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.6 }}>
              <CircularProgress size={15} />
              <Typography variant="body2" color="text.secondary">
                読み込み中…
              </Typography>
            </Stack>
          ) : firstToday ? (
            <>
              <Typography
                variant="body2"
                fontWeight={900}
                sx={{ mt: 0.35, overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {formatMonthDay(firstToday.date)}　{firstToday.productCode}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {firstToday.qty.toLocaleString('ja-JP')}冊 /{' '}
                {factoryLabel(firstToday.deliveryFactory) || '工場未設定'}
                {todayRows.length > 1 ? ` / ほか${todayRows.length - 1}件` : ''}
              </Typography>
            </>
          ) : (
            <>
              <Typography variant="body2" fontWeight={800} sx={{ mt: 0.35 }}>
                本日は納品予定なし
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {nextRow
                  ? `次回：${formatMonthDay(nextRow.date)} ${nextRow.productCode} ${nextRow.qty.toLocaleString('ja-JP')}冊`
                  : '2週間以内の納品予定はありません'}
              </Typography>
            </>
          )}
        </Box>

        <KeyboardArrowRightRoundedIcon color="primary" />
      </Stack>
    </Paper>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { profile, role } = useAuth();

  const isStaff = role === 'staff' || role === 'admin';

  const [deliveryDialogOpen, setDeliveryDialogOpen] = useState(false);
  const [deliveryRows, setDeliveryRows] = useState([]);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [deliveryError, setDeliveryError] = useState('');

  const cards = isStaff
    ? [
        SHARED_CARDS.orderPlans,
        STAFF_CARDS.estimates,
        STAFF_CARDS.dempyo,
        SHARED_CARDS.packages,
        STAFF_CARDS.printChecklist,
        STAFF_CARDS.labels,
        STAFF_CARDS.inventory,
        SHARED_CARDS.prices,
        SHARED_CARDS.search,
        STAFF_CARDS.binding,
      ]
    : [
        SHARED_CARDS.orderPlans,
        SHARED_CARDS.packages,
        SHARED_CARDS.prices,
        SHARED_CARDS.search,
      ];

  const todayIso = useMemo(() => toLocalIsoDate(new Date()), []);
  const endIso = useMemo(() => toLocalIsoDate(addDays(new Date(), 13)), []);

  const loadDeliveries = useCallback(async () => {
    setDeliveryLoading(true);
    setDeliveryError('');

    try {
      const { data: itemRows, error: itemError } = await supabase
        .from('order_plan_items')
        .select(
          `
            id,
            product_id,
            print_order_qty,
            delivery_factory,
            kawasaki_order_no,
            delivery_schedule,
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
              title
            )
          `,
        )
        .order('updated_at', { ascending: false })
        .limit(1000);

      if (itemError) throw itemError;

      const items = (itemRows || []).filter((item) => item.product);
      const itemIds = items.map((item) => item.id);
      let completionRows = [];

      if (isStaff && itemIds.length > 0) {
        try {
          completionRows = await fetchCompletionRows(itemIds);
        } catch (completionError) {
          // 共有ユーザーや旧環境では完了状態だけ取得できない場合があるため、
          // 納品予定本体の表示は継続します。
          // eslint-disable-next-line no-console
          console.warn(completionError);
        }
      }

      const completionMap = new Map(
        completionRows.map((row) => [
          `${row.order_plan_item_id}:${row.delivery_line_id}`,
          row,
        ]),
      );

      const flattened = [];

      for (const item of items) {
        const schedule = normalizeSchedule(item.delivery_schedule);

        for (const row of schedule) {
          if (!row.date || row.date < todayIso || row.date > endIso) continue;

          const completion = completionMap.get(`${item.id}:${row.id}`) || null;

          flattened.push({
            key: `${item.id}:${row.id}`,
            orderPlanItemId: item.id,
            deliveryLineId: row.id,
            date: row.date,
            qty: row.qty,
            deliveryFactory: item.delivery_factory || '',
            kawasakiOrderNo: item.kawasaki_order_no || '',
            productCode: item.product?.product_code || '',
            productName: item.product?.name || '',
            planDate: item.order_plan?.plan_date || '',
            completed: Boolean(completion),
            completedAt: completion?.completed_at || '',
          });
        }
      }

      flattened.sort((left, right) => {
        const dateCompare = left.date.localeCompare(right.date);
        if (dateCompare !== 0) return dateCompare;
        return left.productCode.localeCompare(right.productCode, 'ja');
      });

      setDeliveryRows(flattened);
    } catch (loadError) {
      // eslint-disable-next-line no-console
      console.error(loadError);
      setDeliveryRows([]);
      setDeliveryError(loadError?.message || '納品予定の取得に失敗しました');
    } finally {
      setDeliveryLoading(false);
    }
  }, [endIso, isStaff, todayIso]);

  useEffect(() => {
    loadDeliveries();
  }, [loadDeliveries]);

  const todayRows = useMemo(
    () => deliveryRows.filter((row) => row.date === todayIso),
    [deliveryRows, todayIso],
  );

  const nextRow = useMemo(
    () => deliveryRows.find((row) => row.date > todayIso) || null,
    [deliveryRows, todayIso],
  );

  const twoWeekTotalQty = useMemo(
    () => deliveryRows.reduce((sum, row) => sum + row.qty, 0),
    [deliveryRows],
  );

  const todayTotalQty = useMemo(
    () => todayRows.reduce((sum, row) => sum + row.qty, 0),
    [todayRows],
  );

  return (
    <Box sx={{ p: 2 }}>
      <Stack
        direction={{ xs: 'column', lg: 'row' }}
        spacing={2}
        alignItems={{ lg: 'flex-start' }}
        justifyContent="space-between"
      >
        <Box sx={{ flex: 1 }}>
          <Typography variant="h3" fontWeight={900}>
            ダッシュボード
          </Typography>

          <Typography sx={{ mt: 1, color: 'text.secondary' }}>
            ようこそ {profile?.display_name || profile?.email || ''}（role: {role || '-'}）
          </Typography>
        </Box>

        <DeliverySummaryButton
          loading={deliveryLoading}
          todayRows={todayRows}
          nextRow={nextRow}
          onOpen={() => setDeliveryDialogOpen(true)}
        />
      </Stack>

      {deliveryError && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          納品予定の表示だけ取得できませんでした：{deliveryError}
        </Alert>
      )}

      <Paper
        variant="outlined"
        sx={{
          mt: 2.5,
          p: 2,
          borderColor: 'rgba(77, 208, 225, 0.32)',
          bgcolor: 'rgba(77, 208, 225, 0.045)',
        }}
      >
        <Typography fontWeight={900}>現在の業務フロー</Typography>
        <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
          ① 計画書（発注）で品番・印刷手配数・納品予定を登録 → ② 見積へ数量を自動反映 →
          ③ 印刷手配チェックリストで手配工程を確認 → ④ 納品日ごとに「納品済」を登録 →
          ⑤ 在庫管理（納品完了）で残数を確認
        </Typography>
      </Paper>

      <Box
        sx={{
          mt: 2.5,
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            md: 'repeat(2, minmax(0, 1fr))',
            xl: 'repeat(3, minmax(0, 1fr))',
          },
          gap: 2,
        }}
      >
        {cards.map((card) => (
          <DashboardCard key={card.path} card={card} onOpen={navigate} />
        ))}
      </Box>

      <Dialog
        open={deliveryDialogOpen}
        onClose={() => setDeliveryDialogOpen(false)}
        fullWidth
        maxWidth="lg"
      >
        <DialogTitle sx={{ pr: 7 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <CalendarMonthRoundedIcon color="primary" />
            <Box>
              <Typography variant="h6" fontWeight={900}>
                本日から2週間の納品スケジュール
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {formatDateWithWeekday(todayIso)} ～ {formatDateWithWeekday(endIso)}
              </Typography>
            </Box>
          </Stack>

          <Stack direction="row" spacing={0.5} sx={{ position: 'absolute', right: 10, top: 10 }}>
            <Tooltip title="再読み込み">
              <IconButton onClick={loadDeliveries} disabled={deliveryLoading}>
                <RefreshRoundedIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="閉じる">
              <IconButton onClick={() => setDeliveryDialogOpen(false)}>
                <CloseRoundedIcon />
              </IconButton>
            </Tooltip>
          </Stack>
        </DialogTitle>

        <DialogContent dividers>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
            <Chip
              label={`本日 ${todayRows.length}件・${todayTotalQty.toLocaleString('ja-JP')}冊`}
              color="primary"
              variant="outlined"
            />
            <Chip
              label={`2週間合計 ${deliveryRows.length}件・${twoWeekTotalQty.toLocaleString('ja-JP')}冊`}
              variant="outlined"
            />
          </Stack>

          {deliveryError && <Alert severity="warning">{deliveryError}</Alert>}

          {deliveryLoading ? (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 5, justifyContent: 'center' }}>
              <CircularProgress size={22} />
              <Typography>納品予定を読み込んでいます…</Typography>
            </Stack>
          ) : deliveryRows.length === 0 ? (
            <Alert severity="info">本日から2週間以内の納品予定はありません。</Alert>
          ) : (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 900 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>納品日</TableCell>
                    <TableCell>品番</TableCell>
                    <TableCell>商品名</TableCell>
                    <TableCell align="right">冊数</TableCell>
                    <TableCell>納品工場</TableCell>
                    <TableCell>注文番号</TableCell>
                    {isStaff && <TableCell>納品状態</TableCell>}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {deliveryRows.map((row) => {
                    const isToday = row.date === todayIso;

                    return (
                      <TableRow
                        key={row.key}
                        hover
                        sx={{
                          bgcolor: isToday ? 'rgba(77, 208, 225, 0.065)' : undefined,
                        }}
                      >
                        <TableCell>
                          <Stack direction="row" spacing={0.7} alignItems="center">
                            <Typography fontWeight={isToday ? 900 : 700}>
                              {formatDateWithWeekday(row.date)}
                            </Typography>
                            {isToday && <Chip size="small" label="本日" color="primary" />}
                          </Stack>
                        </TableCell>
                        <TableCell sx={{ fontWeight: 900 }}>{row.productCode || '-'}</TableCell>
                        <TableCell>{row.productName || '-'}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 900 }}>
                          {row.qty.toLocaleString('ja-JP')}冊
                        </TableCell>
                        <TableCell>{factoryLabel(row.deliveryFactory) || '-'}</TableCell>
                        <TableCell>{row.kawasakiOrderNo || '-'}</TableCell>
                        {isStaff && (
                          <TableCell>
                            {row.completed ? (
                              <Chip size="small" label="納品済" color="success" />
                            ) : (
                              <Chip size="small" label="未納品" variant="outlined" />
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          )}
        </DialogContent>

        <DialogActions>
          {isStaff && (
            <Button onClick={() => navigate('/inventory')} variant="outlined">
              在庫管理（納品完了）を開く
            </Button>
          )}
          <Button onClick={() => setDeliveryDialogOpen(false)} variant="contained">
            閉じる
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
