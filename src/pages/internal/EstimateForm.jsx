// src/pages/internal/EstimateForm.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient.jsx';

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

// ===============================
// 計算ヘルパー（参考コード準拠）
// ===============================

// 面付数を求める (A6=64を追加)
function getImpositionSize(size) {
  switch (size) {
    case 'A3':
      return 8;
    case 'A4':
      return 16;
    case 'A5':
    case 'B5':
      return 32;
    case 'A6':
      return 64;
    case 'B4':
      return 16;
    default:
      return 16;
  }
}

// 0.5刻みで繰り上げ
function roundUpToHalf(num) {
  return Math.ceil(num * 2) / 2;
}

/**
 * 数値として解釈できる部分だけを抜き出して number にする（自由テキスト入力対応）
 * 例：
 *  - "1,000" -> 1000
 *  - "3,000円" -> 3000
 *  - "57.5K" -> 57.5
 *  - "4C/1C" -> 4
 *  - "" -> 0
 */
function normalizeNumericString(v) {
  let s = String(v ?? '').trim();
  if (!s) return '';

  // 全角数字 → 半角
  s = s.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));

  // 全角記号の一部補正
  s = s.replace(/／/g, '/').replace(/－/g, '-').replace(/．/g, '.');

  // 桁区切り（カンマ/全角カンマ）削除、通貨記号・空白の削除
  s = s.replace(/[,\uFF0C]/g, '').replace(/[¥￥\s]/g, '');

  return s;
}

function toNumLoose(v) {
  const s = normalizeNumericString(v);
  if (!s) return 0;

  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return 0;

  const n = Number(m[0]);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 利益率など「%入力」を許す数値
 *  - "1.1" -> 1.1
 *  - "110%" / "110％" -> 1.1
 */
function toRateLoose(v, fallback = 1) {
  const raw = String(v ?? '').trim();
  if (!raw) return fallback;

  const n = toNumLoose(raw);
  if (!Number.isFinite(n)) return fallback;

  const isPercent = raw.includes('%') || raw.includes('％');
  return isPercent ? n / 100 : n;
}

function yen(n) {
  const num = Number(n || 0);
  return `${Math.round(num).toLocaleString('ja-JP')} 円`;
}

// 用紙必要数の計算（VP/GTO/オンデマンド）
function calcNeededPaper(detail) {
  const quantity = toNumLoose(detail.quantity);
  const pages = toNumLoose(detail.pages);
  const colors = toNumLoose(detail.colors);
  const is_double_sided = !!detail.is_double_sided;
  const machine = detail.machine;
  const size = detail.size;

  const imposition = getImpositionSize(size);
  const doubleSideFactor = is_double_sided ? 2 : 1;

  if (machine === 'VP') {
    const pageDiv = Math.max(1, Math.ceil(pages / imposition));
    const base = Math.ceil((quantity * pages) / imposition);
    const extra = colors * 70 * doubleSideFactor * pageDiv;
    return base + extra;
  }

  if (machine === 'GTO') {
    const base = Math.ceil((quantity * pages) / imposition);
    const extra = colors * 30 * doubleSideFactor;
    return base + extra;
  }

  return Math.ceil((quantity * pages) / imposition);
}

// 用紙代計算
function calcPaperCost({ needed_paper, paper_thickness, paper_unit_price }) {
  const needed = toNumLoose(needed_paper);
  const thickness = toNumLoose(paper_thickness);
  const unit = toNumLoose(paper_unit_price);

  const reams = roundUpToHalf(needed / 1000);
  return reams * thickness * unit * 1.2;
}

// 製版代 (VP, GTOのみ)
function calcPlateCost({ machine, colors, is_double_sided, plate_unit_cost, pages, size }) {
  if (machine === 'オンデマンド') return 0;

  const colorsN = toNumLoose(colors);
  const plateUnit = toNumLoose(plate_unit_cost);
  const pagesN = toNumLoose(pages);

  const doubleSideFactor = !!is_double_sided ? 2 : 1;
  const imposition = getImpositionSize(size);
  const base = Math.ceil(pagesN / imposition);

  return colorsN * doubleSideFactor * plateUnit * base;
}

// 印刷代
function calcPrintCost({ machine, colors, is_double_sided, print_unit_cost, quantity, pages, size }) {
  const colorsN = toNumLoose(colors);
  const printUnit = toNumLoose(print_unit_cost);
  const qty = toNumLoose(quantity);
  const pagesN = toNumLoose(pages);

  const doubleSideFactor = !!is_double_sided ? 2 : 1;
  const imposition = getImpositionSize(size);
  const pageDiv = Math.max(1, Math.ceil(pagesN / imposition));

  if (machine === 'オンデマンド') {
    // ※現状仕様は維持（必要であれば別途ルール定義して調整可能）
    const baseCount = Math.ceil((qty * pagesN) / imposition);
    return printUnit * baseCount * 4;
  }

  if (machine === 'VP') {
    // ★修正：base に pageDiv を掛ける（ページ割/台数分だけ立ち上げが発生する想定）
    const base = colorsN * doubleSideFactor * printUnit * pageDiv;

    let leftoverRaw = (qty * pagesN) / imposition - 1000;
    if (leftoverRaw < 0) leftoverRaw = 0;
    const leftover = leftoverRaw * 1.5 * pageDiv;

    return base + leftover;
  }

  if (machine === 'GTO') {
    // ★修正：base に pageDiv を掛ける
    const base = colorsN * doubleSideFactor * printUnit * pageDiv;

    let leftoverRaw = ((qty * pagesN) / imposition) * 4 - 1000;
    if (leftoverRaw < 0) leftoverRaw = 0;
    const leftover = leftoverRaw * 4 * 1.5 * pageDiv;

    return base + leftover;
  }

  return 0;
}

// -----------------------------------------------
// 初期値（自由入力したいので state は「文字列」で保持する）
const DEFAULT_NEW_DETAIL = {
  detail_type: '表紙',
  size: 'A5',
  quantity: '1000',
  pages: '2',
  colors: '4',
  is_double_sided: true,
  binding_method: '',

  design_type: 'inhouse',
  design_outsource_cost: '0',
  design_profit_rate: '1.1',
  design_inhouse_unit_cost: '0',

  print_type: 'inhouse',
  print_outsource_cost: '0',
  print_profit_rate: '1.1',

  machine: 'VP',
  paper_type: '上質',
  paper_thickness: '44.5',
  paper_unit_price: '200',
  plate_unit_cost: '3000',
  print_unit_cost: '3000',
  binding_cost: '0',
  shipping_cost: '0',
};

function safeStr(v, fallback = '') {
  if (v === null || v === undefined) return fallback;
  return String(v);
}

// DBの明細行 → 入力フォーム(newDetail) に復元する
function detailRowToNewDetail(d) {
  return {
    detail_type: safeStr(d.detail_type, DEFAULT_NEW_DETAIL.detail_type),
    size: safeStr(d.size, DEFAULT_NEW_DETAIL.size),
    quantity: safeStr(d.quantity, DEFAULT_NEW_DETAIL.quantity),
    pages: safeStr(d.pages, DEFAULT_NEW_DETAIL.pages),
    colors: safeStr(d.colors, DEFAULT_NEW_DETAIL.colors),
    is_double_sided: !!d.is_double_sided,
    binding_method: safeStr(d.binding_method, ''),

    design_type: safeStr(d.design_type, DEFAULT_NEW_DETAIL.design_type),
    design_outsource_cost: safeStr(d.design_outsource_cost, DEFAULT_NEW_DETAIL.design_outsource_cost),
    design_profit_rate: safeStr(d.design_profit_rate, DEFAULT_NEW_DETAIL.design_profit_rate),
    design_inhouse_unit_cost: safeStr(d.design_inhouse_unit_cost, DEFAULT_NEW_DETAIL.design_inhouse_unit_cost),

    print_type: safeStr(d.print_type, DEFAULT_NEW_DETAIL.print_type),
    print_outsource_cost: safeStr(d.print_outsource_cost, DEFAULT_NEW_DETAIL.print_outsource_cost),
    print_profit_rate: safeStr(d.print_profit_rate, DEFAULT_NEW_DETAIL.print_profit_rate),

    machine: safeStr(d.machine, DEFAULT_NEW_DETAIL.machine),
    paper_type: safeStr(d.paper_type, DEFAULT_NEW_DETAIL.paper_type),
    paper_thickness: safeStr(d.paper_thickness, DEFAULT_NEW_DETAIL.paper_thickness),
    paper_unit_price: safeStr(d.paper_unit_price, DEFAULT_NEW_DETAIL.paper_unit_price),
    plate_unit_cost: safeStr(d.plate_unit_cost, DEFAULT_NEW_DETAIL.plate_unit_cost),
    print_unit_cost: safeStr(d.print_unit_cost, DEFAULT_NEW_DETAIL.print_unit_cost),
    binding_cost: safeStr(d.binding_cost, DEFAULT_NEW_DETAIL.binding_cost),
    shipping_cost: safeStr(d.shipping_cost, DEFAULT_NEW_DETAIL.shipping_cost),
  };
}

function formatDeliverySchedule(list) {
  const arr = Array.isArray(list) ? list : [];
  if (arr.length === 0) return '未設定';

  return arr
    .map((r, idx) => {
      const date = r?.date ? String(r.date) : '';
      const qty = r?.qty ?? '';
      const qtyText =
        qty === null || qty === undefined || qty === ''
          ? ''
          : ` / ${Number(qty).toLocaleString('ja-JP')} 部`;
      return `(${idx + 1}) ${date || '未設定'}${qtyText}`;
    })
    .join('  ');
}

// -----------------------------------------------
export default function EstimateForm({ estimateId, onDetailsLoaded, meta }) {
  const [detailList, setDetailList] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // クリックで復元した行の強調表示用
  const [restoredDetailId, setRestoredDetailId] = useState(null);

  // ★重要：自由入力したいので state は「文字列」で保持する
  const [newDetail, setNewDetail] = useState(() => ({ ...DEFAULT_NEW_DETAIL }));

  // 復元時にフォームへスクロール
  const formTopRef = useRef(null);

  // 明細一覧を取得
  useEffect(() => {
    if (!estimateId) return;

    setRestoredDetailId(null);
    // 見積切替時は入力も初期化（混在防止）
    setNewDetail({ ...DEFAULT_NEW_DETAIL });

    fetchDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateId]);

  async function fetchDetails() {
    setError('');

    const { data, error: fetchErr } = await supabase
      .from('estimate_details')
      .select('*')
      .eq('estimate_id', estimateId)
      .order('created_at', { ascending: true });

    if (fetchErr) {
      // eslint-disable-next-line no-console
      console.error(fetchErr);
      setError(fetchErr.message || '明細取得に失敗しました');
      return;
    }

    setDetailList(data || []);
    if (onDetailsLoaded) onDetailsLoaded(data || []);
  }

  async function deleteDetail(detailId) {
    if (!window.confirm('本当に削除しますか？')) return;

    setBusy(true);
    setError('');

    try {
      const { error: delErr } = await supabase.from('estimate_details').delete().eq('id', detailId);
      if (delErr) throw delErr;
      await fetchDetails();
    } catch (e) {
      setError(e?.message || '削除時にエラーが発生しました');
    } finally {
      setBusy(false);
    }
  }

  // 明細行をクリック → 入力欄へ復元
  function restoreFromRow(d) {
    const next = detailRowToNewDetail(d);
    setNewDetail(next);
    setRestoredDetailId(d.id);

    // 入力フォームへスクロール
    setTimeout(() => {
      try {
        formTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch {
        // noop
      }
    }, 0);
  }

  // 入力フォーム変更：★文字列のまま保持（自由入力）
  function handleChange(e) {
    const { name, type, checked, value } = e.target;

    setNewDetail((prev) => {
      if (type === 'checkbox') return { ...prev, [name]: checked };
      return { ...prev, [name]: value };
    });
  }

  // デザイン費
  function calcDesignCost(detail) {
    if (detail.design_type === 'outsourced') {
      const outsource = toNumLoose(detail.design_outsource_cost);
      const rate = toRateLoose(detail.design_profit_rate, 1);
      return outsource * rate;
    }
    return toNumLoose(detail.design_inhouse_unit_cost) * toNumLoose(detail.pages);
  }

  // 社内印刷の詳細計算
  function calcInhousePrint(detail) {
    const needed_paper = calcNeededPaper(detail);

    const paper_cost = calcPaperCost({
      needed_paper,
      paper_thickness: detail.paper_thickness,
      paper_unit_price: detail.paper_unit_price,
    });

    const plate_cost = calcPlateCost({
      machine: detail.machine,
      colors: detail.colors,
      is_double_sided: detail.is_double_sided,
      plate_unit_cost: detail.plate_unit_cost,
      pages: detail.pages,
      size: detail.size,
    });

    const print_cost = calcPrintCost({
      machine: detail.machine,
      colors: detail.colors,
      is_double_sided: detail.is_double_sided,
      print_unit_cost: detail.print_unit_cost,
      quantity: detail.quantity,
      pages: detail.pages,
      size: detail.size,
    });

    const bind = toNumLoose(detail.binding_cost);
    const ship = toNumLoose(detail.shipping_cost);

    const total = paper_cost + plate_cost + print_cost + bind + ship;

    return {
      needed_paper,
      paper_cost,
      plate_cost,
      print_cost, // 印刷機の「印刷代」部分
      inhouse_total: total, // 紙・版・印刷・製本・発送を含む合計
    };
  }

  // 印刷費トータル
  function calcPrintCostTotal(detail) {
    if (detail.print_type === 'outsourced') {
      const cost = toNumLoose(detail.print_outsource_cost);
      const rate = toRateLoose(detail.print_profit_rate, 1);
      const v = cost * rate;

      return {
        needed_paper: 0,
        paper_cost: 0,
        plate_cost: 0,
        print_cost: v,
        inhouse_total: v,
      };
    }
    return calcInhousePrint(detail);
  }

  const preview = useMemo(() => {
    const designCost = calcDesignCost(newDetail);
    const printResult = calcPrintCostTotal(newDetail);
    const printTotal = toNumLoose(printResult.inhouse_total);
    const total = designCost + printTotal;

    return {
      designCost,
      neededPaper: toNumLoose(printResult.needed_paper),
      paperCost: toNumLoose(printResult.paper_cost),
      plateCost: toNumLoose(printResult.plate_cost),
      printCost: toNumLoose(printResult.print_cost),
      printTotal,
      total,
    };
  }, [newDetail]);

  // 新規明細をINSERT
  async function saveDetail() {
    if (!estimateId) {
      alert('見積IDがありません');
      return;
    }

    setBusy(true);
    setError('');

    try {
      const designCost = calcDesignCost(newDetail);
      const printResult = calcPrintCostTotal(newDetail);

      const print_total_cost = toNumLoose(printResult.inhouse_total);
      const total_estimated_cost = designCost + print_total_cost;

      const payload = {
        estimate_id: estimateId,

        detail_type: newDetail.detail_type,
        size: newDetail.size,
        quantity: Math.round(toNumLoose(newDetail.quantity)),
        pages: Math.round(toNumLoose(newDetail.pages)),
        colors: String(Math.round(toNumLoose(newDetail.colors))),
        is_double_sided: !!newDetail.is_double_sided,
        binding_method: newDetail.binding_method || '',

        design_type: newDetail.design_type,
        design_outsource_cost: toNumLoose(newDetail.design_outsource_cost),
        design_profit_rate: toRateLoose(newDetail.design_profit_rate, 1),
        design_inhouse_unit_cost: toNumLoose(newDetail.design_inhouse_unit_cost),
        design_cost: designCost,

        print_type: newDetail.print_type,
        print_outsource_cost: toNumLoose(newDetail.print_outsource_cost),
        print_profit_rate: toRateLoose(newDetail.print_profit_rate, 1),

        machine: newDetail.machine,
        paper_type: newDetail.paper_type || '',
        paper_thickness: toNumLoose(newDetail.paper_thickness),
        paper_unit_price: toNumLoose(newDetail.paper_unit_price),

        plate_unit_cost: toNumLoose(newDetail.plate_unit_cost),
        print_unit_cost: toNumLoose(newDetail.print_unit_cost),
        binding_cost: toNumLoose(newDetail.binding_cost),
        shipping_cost: toNumLoose(newDetail.shipping_cost),

        needed_paper: toNumLoose(printResult.needed_paper),
        paper_cost: toNumLoose(printResult.paper_cost),
        plate_cost: toNumLoose(printResult.plate_cost),

        // print_cost: 社内=印刷代のみ / 外注=外注印刷費（利益込）
        print_cost: toNumLoose(printResult.print_cost),

        // print_total_cost: 社内=紙+版+印刷+製本+発送 / 外注=外注印刷費（利益込）
        print_total_cost,

        total_estimated_cost,
      };

      const { error: insErr } = await supabase.from('estimate_details').insert(payload);
      if (insErr) throw insErr;

      // 入力一部リセット（数量だけ戻す）
      setNewDetail((prev) => ({
        ...prev,
        quantity: '1000',
      }));
      setRestoredDetailId(null);

      await fetchDetails();
    } catch (e) {
      setError(e?.message || '明細追加に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack spacing={2}>
      <Typography variant="h6" fontWeight={900}>
        見積明細（計算・追加）
      </Typography>

      {error && <Alert severity="error">{error}</Alert>}

      {/* 明細一覧 */}
      <Paper sx={{ p: 1 }}>
        <Typography fontWeight={800} sx={{ px: 1, py: 1 }}>
          明細一覧（行クリックで入力へ復元）
        </Typography>

        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>詳細</TableCell>
              <TableCell>サイズ</TableCell>
              <TableCell align="right">数量</TableCell>
              <TableCell align="right">P</TableCell>
              <TableCell align="right">色</TableCell>
              <TableCell align="right">必要用紙</TableCell>
              <TableCell align="right">デザイン費</TableCell>
              <TableCell align="right">印刷費（見積）</TableCell>
              <TableCell align="right">小計（税別）</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {detailList.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} sx={{ textAlign: 'center', color: 'text.secondary' }}>
                  明細がありません
                </TableCell>
              </TableRow>
            ) : (
              detailList.map((d) => (
                <TableRow
                  key={d.id}
                  hover
                  selected={d.id === restoredDetailId}
                  sx={{ cursor: 'pointer' }}
                  onClick={() => restoreFromRow(d)}
                >
                  <TableCell>{d.detail_type}</TableCell>
                  <TableCell>
                    {d.size}
                    {d.binding_method ? ` / 製本: ${d.binding_method}` : ''}
                  </TableCell>
                  <TableCell align="right">{d.quantity}</TableCell>
                  <TableCell align="right">{d.pages}</TableCell>
                  <TableCell align="right">
                    {d.colors}
                    {d.is_double_sided ? ' (両面)' : ' (片面)'}
                  </TableCell>
                  <TableCell align="right">
                    {d.needed_paper ? Math.round(Number(d.needed_paper)).toLocaleString('ja-JP') : '-'}
                  </TableCell>
                  <TableCell align="right">{yen(d.design_cost)}</TableCell>
                  <TableCell align="right">{yen(d.print_total_cost)}</TableCell>
                  <TableCell align="right">{yen(d.total_estimated_cost)}</TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => restoreFromRow(d)}
                        disabled={busy}
                      >
                        入力へ反映
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        variant="outlined"
                        onClick={() => deleteDetail(d.id)}
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
      </Paper>

      <Divider />

      {/* 追加フォーム */}
      <Paper sx={{ p: 2 }} ref={formTopRef}>
        <Stack spacing={2}>
          <Typography fontWeight={900}>明細を追加（自動計算）</Typography>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '220px 1fr' },
              gap: 1.2,
              alignItems: 'center',
            }}
          >
            <Typography fontWeight={700}>詳細</Typography>
            <FormControl>
              <InputLabel id="detail-type-label">詳細</InputLabel>
              <Select
                labelId="detail-type-label"
                label="詳細"
                name="detail_type"
                value={newDetail.detail_type}
                onChange={handleChange}
              >
                <MenuItem value="指定無し">指定無し</MenuItem>
                <MenuItem value="表紙">表紙</MenuItem>
                <MenuItem value="本文">本文</MenuItem>
                <MenuItem value="表紙＋本文">表紙＋本文（同じ用紙）</MenuItem>
              </Select>
            </FormControl>

            <Typography fontWeight={700}>サイズ</Typography>
            <FormControl>
              <InputLabel id="size-label">サイズ</InputLabel>
              <Select
                labelId="size-label"
                label="サイズ"
                name="size"
                value={newDetail.size}
                onChange={handleChange}
              >
                <MenuItem value="A3">A3</MenuItem>
                <MenuItem value="A4">A4</MenuItem>
                <MenuItem value="A5">A5</MenuItem>
                <MenuItem value="A6">A6</MenuItem>
                <MenuItem value="B4">B4</MenuItem>
                <MenuItem value="B5">B5</MenuItem>
              </Select>
            </FormControl>

            <Typography fontWeight={700}>数量（自由入力OK）</Typography>
            <TextField
              name="quantity"
              value={newDetail.quantity}
              onChange={handleChange}
              placeholder="例：1,000 / 1000部"
            />

            <Typography fontWeight={700}>ページ数（自由入力OK）</Typography>
            <TextField
              name="pages"
              value={newDetail.pages}
              onChange={handleChange}
              placeholder="例：12P / 16 / 16P"
            />

            <Typography fontWeight={700}>刷り色（自由入力OK）</Typography>
            <TextField name="colors" value={newDetail.colors} onChange={handleChange} placeholder="例：4 / 4C / 4/1" />

            <Typography fontWeight={700}>両面</Typography>
            <FormControl>
              <InputLabel id="double-label">両面</InputLabel>
              <Select
                labelId="double-label"
                label="両面"
                name="is_double_sided"
                value={newDetail.is_double_sided ? 'true' : 'false'}
                onChange={(e) => {
                  setNewDetail((prev) => ({ ...prev, is_double_sided: e.target.value === 'true' }));
                }}
              >
                <MenuItem value="true">両面</MenuItem>
                <MenuItem value="false">片面</MenuItem>
              </Select>
            </FormControl>

            <Typography fontWeight={700}>製本</Typography>
            <TextField
              name="binding_method"
              value={newDetail.binding_method}
              onChange={handleChange}
              placeholder="例：中綴じ、無線綴じ など"
            />

            <Typography fontWeight={700}>デザイン区分</Typography>
            <FormControl>
              <InputLabel id="design-type-label">デザイン区分</InputLabel>
              <Select
                labelId="design-type-label"
                label="デザイン区分"
                name="design_type"
                value={newDetail.design_type}
                onChange={handleChange}
              >
                <MenuItem value="inhouse">社内</MenuItem>
                <MenuItem value="outsourced">外注</MenuItem>
              </Select>
            </FormControl>

            {newDetail.design_type === 'outsourced' ? (
              <>
                <Typography fontWeight={700}>外注費（自由入力OK）</Typography>
                <TextField
                  name="design_outsource_cost"
                  value={newDetail.design_outsource_cost}
                  onChange={handleChange}
                  placeholder="例：30,000円"
                />

                <Typography fontWeight={700}>利益率（自由入力OK）</Typography>
                <TextField
                  name="design_profit_rate"
                  value={newDetail.design_profit_rate}
                  onChange={handleChange}
                  placeholder="例：1.1 / 110%"
                />
              </>
            ) : (
              <>
                <Typography fontWeight={700}>社内単価（円/ページ）（自由入力OK）</Typography>
                <TextField
                  name="design_inhouse_unit_cost"
                  value={newDetail.design_inhouse_unit_cost}
                  onChange={handleChange}
                  placeholder="例：500円"
                />
                <Typography />
                <Box />
              </>
            )}

            <Typography fontWeight={700}>印刷区分</Typography>
            <FormControl>
              <InputLabel id="print-type-label">印刷区分</InputLabel>
              <Select
                labelId="print-type-label"
                label="印刷区分"
                name="print_type"
                value={newDetail.print_type}
                onChange={handleChange}
              >
                <MenuItem value="inhouse">社内</MenuItem>
                <MenuItem value="outsourced">外注</MenuItem>
              </Select>
            </FormControl>

            {newDetail.print_type === 'outsourced' ? (
              <>
                <Typography fontWeight={700}>外注印刷仕入（自由入力OK）</Typography>
                <TextField
                  name="print_outsource_cost"
                  value={newDetail.print_outsource_cost}
                  onChange={handleChange}
                  placeholder="例：80,000円"
                />

                <Typography fontWeight={700}>利益率（自由入力OK）</Typography>
                <TextField
                  name="print_profit_rate"
                  value={newDetail.print_profit_rate}
                  onChange={handleChange}
                  placeholder="例：1.1 / 110%"
                />
              </>
            ) : (
              <>
                <Typography fontWeight={700}>印刷機</Typography>
                <FormControl>
                  <InputLabel id="machine-label">印刷機</InputLabel>
                  <Select
                    labelId="machine-label"
                    label="印刷機"
                    name="machine"
                    value={newDetail.machine}
                    onChange={handleChange}
                  >
                    <MenuItem value="VP">VP</MenuItem>
                    <MenuItem value="GTO">GTO</MenuItem>
                    <MenuItem value="オンデマンド">オンデマンド</MenuItem>
                  </Select>
                </FormControl>

                <Typography fontWeight={700}>用紙種類</Typography>
                <TextField name="paper_type" value={newDetail.paper_type} onChange={handleChange} />

                <Typography fontWeight={700}>用紙厚み（K）（自由入力OK）</Typography>
                <TextField
                  name="paper_thickness"
                  value={newDetail.paper_thickness}
                  onChange={handleChange}
                  placeholder="例：57.5K"
                />

                <Typography fontWeight={700}>用紙単価（自由入力OK）</Typography>
                <TextField
                  name="paper_unit_price"
                  value={newDetail.paper_unit_price}
                  onChange={handleChange}
                  placeholder="例：200円"
                />

                <Typography fontWeight={700}>製版単価（円）（自由入力OK）</Typography>
                <TextField
                  name="plate_unit_cost"
                  value={newDetail.plate_unit_cost}
                  onChange={handleChange}
                  placeholder="例：3,000円"
                />

                <Typography fontWeight={700}>印刷単価（円）（自由入力OK）</Typography>
                <TextField
                  name="print_unit_cost"
                  value={newDetail.print_unit_cost}
                  onChange={handleChange}
                  placeholder="例：VP=3000~6000, GTO=2000~4000"
                />

                <Typography fontWeight={700}>製本代（自由入力OK）</Typography>
                <TextField
                  name="binding_cost"
                  value={newDetail.binding_cost}
                  onChange={handleChange}
                  placeholder="例：10,000円"
                />

                <Typography fontWeight={700}>発送費（自由入力OK）</Typography>
                <TextField
                  name="shipping_cost"
                  value={newDetail.shipping_cost}
                  onChange={handleChange}
                  placeholder="例：5,000円"
                />
              </>
            )}
          </Box>

          <Divider />

          {/* 計算プレビュー */}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography fontWeight={900}>計算プレビュー（税別）</Typography>

            {/* ★追加：納品・注文情報をここで確認 */}
            {meta && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="body2">
                  納品工場：{meta.deliveryFactoryLabel || meta.deliveryFactory || '未設定'}
                </Typography>
                <Typography variant="body2">
                  注文番号：{String(meta.kawasakiOrderNo || '').trim() || '未設定'}
                </Typography>
                <Typography variant="body2">
                  納品予定：{formatDeliverySchedule(meta.deliverySchedule)}
                </Typography>
                <Divider sx={{ my: 1 }} />
              </Box>
            )}

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mt: 1 }}>
              <Box>
                <Typography variant="body2">デザイン費：{yen(preview.designCost)}</Typography>
                <Typography variant="body2">
                  必要用紙：{Math.round(preview.neededPaper).toLocaleString('ja-JP')}
                </Typography>
                <Typography variant="body2">用紙代：{yen(preview.paperCost)}</Typography>
                <Typography variant="body2">製版代：{yen(preview.plateCost)}</Typography>
                <Typography variant="body2">印刷代（印刷機/外注費）：{yen(preview.printCost)}</Typography>
              </Box>
              <Box>
                <Typography variant="body2">印刷費（見積に載せる総額）：{yen(preview.printTotal)}</Typography>
                <Typography variant="h6" fontWeight={900} sx={{ mt: 1 }}>
                  小計：{yen(preview.total)}
                </Typography>
              </Box>
            </Stack>

            <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
              ※数値として解釈できない入力は 0 として扱います（例：&quot;abc&quot; → 0）。
            </Typography>
          </Paper>

          <Stack direction="row" spacing={1}>
            <Button variant="contained" onClick={saveDetail} disabled={busy}>
              {busy ? '保存中…' : '価格を算出して明細追加'}
            </Button>
            <Button variant="outlined" onClick={fetchDetails} disabled={busy}>
              再読込
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  );
}
