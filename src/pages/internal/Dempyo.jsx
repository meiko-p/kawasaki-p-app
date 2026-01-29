// src/pages/internal/Dempyo.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

import { supabase } from '../../supabaseClient.jsx';
import RequireRole from '../../components/RequireRole.jsx';

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
  TextField,
  Typography,
} from '@mui/material';

/** =========================================================
 *  固定：川崎
 * ========================================================= */
const KAWASAKI_CLIENT_NAME = '川崎重工業株式会社';

const DELIVERY_FACTORY_OPTIONS = [
  { value: '76', label: '76工場' },
  { value: '85', label: '85工場' },
  { value: '86', label: '86工場' },
];

function factoryLabel(v) {
  return DELIVERY_FACTORY_OPTIONS.find((x) => x.value === v)?.label || (v ? String(v) : '');
}

/** =========================================================
 *  テンプレ画像（Vite: public/ 配下）
 * ========================================================= */
const BASE_URL = import.meta.env.BASE_URL || '/';

const IMG_TEJUN = `${BASE_URL}forms/tezyun.jpg`;
const IMG_KOUTEI = `${BASE_URL}forms/koutei.jpg`;
const IMG_URIAGE = `${BASE_URL}forms/uriage.jpg`;
const IMG_TOKUSAKI = `${BASE_URL}forms/tokusaki.jpg`;

/** 下絵の基準サイズ（この基準で座標を置く） */
const BASE_W = 768;
const BASE_H_FORM = 1114; // 手順票・工程表
const BASE_H_SLIP = 1181; // 売上・得意先元帳

/** =========================================================
 *  6桁 伝票番号（localStorage採番）
 *  - 2つのPDF（セット1/元帳）を両方出力したタイミングで「次番号へ進める」
 * ========================================================= */
const SERIAL_NEXT_KEY = 'app.slipSerial.next';
const pad6 = (v) => String(v ?? '').replace(/[^\d]/g, '').slice(0, 6).padStart(6, '0');

/** ファイル名に使えるようにサニタイズ */
function sanitizeFileName(s) {
  return String(s || 'file').replace(/[\\/:*?"<>|]/g, '');
}

/** delivery_schedule の正規化（DBが JSON/文字列どちらでもOK） */
function normalizeDeliverySchedule(v) {
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

/** YYYY-MM-DD -> M/D（10文字が枠に入りにくいので短縮） */
function formatMD(dateStr) {
  const s = String(dateStr || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  if (!Number.isFinite(mm) || !Number.isFinite(dd) || mm <= 0 || dd <= 0) return s;
  return `${mm}/${dd}`;
}

/** 文字列から“読み取れる数字だけ”抜き出して数値化（例: "12,300円 調整" -> 12300） */
function parseAmountLike(s) {
  if (s === null || s === undefined) return 0;
  const cleaned = String(s).replace(/[^\d\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '--') return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** 通貨文字列 */
const yen = (n) => `${Math.round(Number(n) || 0).toLocaleString('ja-JP')}円`;

/** =========================================================
 *  小さなオーバーレイ部品（画像 + 位置指定入力）
 * ========================================================= */
const OverlayImage = React.forwardRef(function OverlayImage(
  { src, width = BASE_W, height, children, style },
  ref
) {
  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        width,
        height,
        backgroundImage: `url(${src})`,
        backgroundSize: '100% 100%', // cover だとズレる可能性があるため固定
        backgroundPosition: 'top left',
        backgroundRepeat: 'no-repeat',
        border: '1px solid #ddd',
        backgroundColor: '#fff',
        ...style,
      }}
    >
      {children}
    </div>
  );
});

/** テキスト入力（座標指定, 赤字デフォルト） */
function OVInput({
  x,
  y,
  w = 140,
  h = 22,
  name,
  value,
  onChange,
  readOnly = false,
  align = 'left',
  fontSize = 14,
  color = 'red',
}) {
  return (
    <input
      name={name}
      value={value ?? ''}
      onChange={onChange}
      readOnly={readOnly}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        border: 'none',
        outline: 'none',
        background: 'transparent',
        color,
        fontSize,
        textAlign: align,
        padding: 0,
        margin: 0,
        boxSizing: 'border-box',
        fontFamily: 'sans-serif',
        pointerEvents: readOnly ? 'none' : 'auto',
      }}
    />
  );
}

/** チェック（☐/☑ 切替） */
function OVCheck({ x, y, value, onToggle, fontSize = 18, color = 'red', title }) {
  return (
    <div
      onClick={onToggle}
      title={title || 'クリックで切替'}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        cursor: 'pointer',
        userSelect: 'none',
        color,
        fontSize,
        lineHeight: `${fontSize}px`,
      }}
    >
      {value ? '☑' : '☐'}
    </div>
  );
}

/** =========================================================
 *  計算ヘルパー：面付/台数/版数/印刷表示
 * ========================================================= */
// 面付（EstimateForm と同じルール）
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
// 台数（ページが面付を超えたら ceil(p/面付)）
function getPageDiv(pages, size) {
  const imp = getImpositionSize(size);
  const p = Number(pages || 0);
  return Math.max(1, Math.ceil(p / imp));
}
// 片面/両面の色表示 例: 4/4, 1/0
function getColorSlash(detail) {
  const c = Number(detail.colors || 0) || 0;
  return detail.is_double_sided ? `${c}/${c}` : `${c}/0`;
}
// 版表示 例: VP => A1×8×2, GTO => A3×8
function getPlateString(detail) {
  const format = detail.machine === 'VP' ? 'A1' : 'A3';
  const colors = Number(detail.colors || 0) || 0;
  const sides = detail.is_double_sided ? 2 : 1;
  const pagesDiv = getPageDiv(detail.pages, detail.size);
  const plates = colors * sides;
  return `${format}×${plates}${pagesDiv > 1 ? `×${pagesDiv}` : ''}`;
}
// 印刷表示
// pageDiv==1 -> baseCount×色/色
// pageDiv>1  -> (部数)×色/色×台数
function getPrintString(detail) {
  const imp = getImpositionSize(detail.size);
  const pageDiv = getPageDiv(detail.pages, detail.size);
  const qty = Number(detail.quantity || 0) || 0;
  const pages = Number(detail.pages || 0) || 0;
  const baseCount = Math.ceil((qty * pages) / imp);
  const col = getColorSlash(detail);
  return pageDiv === 1 ? `${baseCount}×${col}` : `${qty}×${col}×${pageDiv}`;
}

/** =========================================================
 *  DB: 見積一覧 select（products join + 追加カラム）
 * ========================================================= */
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
    active
  )
`;

/** 川崎クライアントID確保（無ければ作成） */
async function ensureKawasakiClient() {
  const { data: found, error: findErr } = await supabase
    .from('clients')
    .select('id,name')
    .eq('name', KAWASAKI_CLIENT_NAME)
    .maybeSingle();

  if (findErr) throw findErr;
  if (found?.id) return found.id;

  const { data: inserted, error: insErr } = await supabase
    .from('clients')
    .insert({ name: KAWASAKI_CLIENT_NAME })
    .select('id')
    .single();

  if (insErr) throw insErr;
  return inserted.id;
}

/** =========================================================
 *  Manual 初期値（毎回新しい配列を作る）
 * ========================================================= */
function createInitialManual() {
  return {
    // 基本仕様
    dueDate: '',
    size: '',
    quantity: '',
    pages: '',
    colorCount: '',
    detailType: '',
    isSingle: false,
    isDouble: true,
    isNew: true,
    isReprint: false,

    // 用紙欄（指定無し/表紙＋本文, 表紙, 本文）
    paper_general_type: '',
    paper_general_thickness: '',
    paper_general_needed: '',
    paper_cover_type: '',
    paper_cover_thickness: '',
    paper_cover_needed: '',
    paper_body_type: '',
    paper_body_thickness: '',
    paper_body_needed: '',

    // 進行関連（自由記述）
    schedule: Array.from({ length: 10 }, () => ({ date: '', text: '' })),
    designMemo: '',
    outsideMemo: '',
    bookMemo: '',
    outsideMemo2: '',
    outsideMemo3: '',
    outsideMemo4: '',
    bookMemo2: '',
    bookMemo3: '',

    // チェック
    designInhouse: false,
    designOutsource: false,
    printInhouse: false,
    printOutsource: false,
    bindInhouse: true,
    bindOutsource: false,
    mVP: false,
    mGTO: false,
    mOD: false,
  };
}

/** =========================================================
 *  本体
 * ========================================================= */
export default function Dempyo() {
  /** ---------- 基本データ ---------- */
  const [clientId, setClientId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [estimates, setEstimates] = useState([]);
  const [selectedEstimateId, setSelectedEstimateId] = useState('');
  const selectedEstimate = useMemo(
    () => estimates.find((e) => e.id === selectedEstimateId) || null,
    [estimates, selectedEstimateId]
  );

  const [detailList, setDetailList] = useState([]);

  /** ---------- 伝票番号（6桁） ---------- */
  const [serialNo, setSerialNo] = useState(() => {
    const next = Number(localStorage.getItem(SERIAL_NEXT_KEY) || '1');
    const initial = Number.isFinite(next) && next > 0 ? next : 1;
    return pad6(initial);
  });

  // 2つのPDFを両方出力したら次番号へ進める（同一伝票番号で揃えるため）
  const [exportFlags, setExportFlags] = useState({ serial: '', set1: false, ledger: false });

  const bumpSerialNext = useCallback((usedSerialStr) => {
    const extracted = String(usedSerialStr || '').replace(/\D/g, '');
    let usedNum = Number(extracted || localStorage.getItem(SERIAL_NEXT_KEY) || '1');
    if (!Number.isFinite(usedNum) || usedNum < 1) usedNum = 1;
    let next = usedNum + 1;
    if (next > 999999) next = 1;

    localStorage.setItem(SERIAL_NEXT_KEY, String(next));
    setSerialNo(pad6(next));
  }, []);

  const onSerialTextChange = (e) => {
    const onlyDigits = String(e.target.value || '').replace(/[^\d]/g, '').slice(0, 6);
    setSerialNo(onlyDigits);
  };
  const onSerialTextBlur = () => setSerialNo((v) => pad6(v));

  /** ---------- 手順票起点：入力状態 ---------- */
  const [manual, setManual] = useState(() => createInitialManual());

  /** ---------- 売上/元帳：金額上書き（文字列） ---------- */
  const [amountDirty, setAmountDirty] = useState(false);
  const [amountOverrideStr, setAmountOverrideStr] = useState({
    design: '',
    paper_general: '',
    paper_cover: '',
    paper_body: '',
    plate1: '',
    plate2: '',
    print1: '',
    print2: '',
    bind1: '',
    bind2: '',
    ship1: '',
    ship2: '',
  });

  /** ---------- 版/印刷行：上書き（文字列） ---------- */
  const [linesDirty, setLinesDirty] = useState(false);
  const [linesOverride, setLinesOverride] = useState({
    plateVP: '',
    plateGTO: '',
    printVP: '',
    printGTO: '',
    printOD: '',
  });

  /** ---------- 下段4枠（単価・請求額・消費税・合計金額） ---------- */
  const [grandText, setGrandText] = useState({ unit: '', total: '', tax: '', total2: '' });
  const [grandDirty, setGrandDirty] = useState({ unit: false, total: false, tax: false, total2: false });

  /** ---------- 参照（PDF化対象） ---------- */
  const setOneRef = useRef(null); // 手順票 + 工程表
  const ledgerRef = useRef(null); // 得意先元帳のみ

  /** ---------- 見積一覧取得 ---------- */
  const fetchEstimates = useCallback(async (cid) => {
    const { data, error: fetchErr } = await supabase
      .from('estimates')
      .select(ESTIMATE_SELECT)
      .eq('client_id', cid)
      .order('created_at', { ascending: false });

    if (fetchErr) throw fetchErr;
    setEstimates(data || []);
  }, []);

  /** 初期：川崎クライアント確保 + 見積一覧 */
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
  }, [fetchEstimates]);

  /** 選択見積が変わったら：明細取得 + 入力状態リセット */
  useEffect(() => {
    let alive = true;

    (async () => {
      if (!selectedEstimate?.id) {
        setDetailList([]);
        setManual(createInitialManual());
        setAmountDirty(false);
        setLinesDirty(false);
        setAmountOverrideStr({
          design: '',
          paper_general: '',
          paper_cover: '',
          paper_body: '',
          plate1: '',
          plate2: '',
          print1: '',
          print2: '',
          bind1: '',
          bind2: '',
          ship1: '',
          ship2: '',
        });
        setLinesOverride({
          plateVP: '',
          plateGTO: '',
          printVP: '',
          printGTO: '',
          printOD: '',
        });
        setGrandText({ unit: '', total: '', tax: '', total2: '' });
        setGrandDirty({ unit: false, total: false, tax: false, total2: false });
        setExportFlags({ serial: '', set1: false, ledger: false });
        return;
      }

      // 1) まず手順票起点の入力を「初期化」してから、見積ヘッダ（納品日等）を反映
      const base = createInitialManual();

      const ds = normalizeDeliverySchedule(selectedEstimate.delivery_schedule);
      if (ds?.length) {
        if (ds[0]?.date) base.dueDate = formatMD(ds[0].date);

        // スケジュール欄の先頭3行に「納品」を流し込み（編集可）
        base.schedule = base.schedule.map((row, i) => {
          const d = ds[i];
          if (!d) return row;
          const date = d.date ? formatMD(d.date) : '';
          const qtyTxt = d.qty !== null && d.qty !== undefined && d.qty !== '' ? ` ${d.qty}部` : '';
          return { date, text: `納品${qtyTxt}` };
        });
      }

      setManual(base);

      // 2) 上書き系は見積切替でリセット
      setAmountDirty(false);
      setLinesDirty(false);
      setGrandText({ unit: '', total: '', tax: '', total2: '' });
      setGrandDirty({ unit: false, total: false, tax: false, total2: false });
      setExportFlags({ serial: '', set1: false, ledger: false });

      // 3) 明細を読み込み（ロード中は自動注入を抑制する）
      setDetailsLoading(true);
      setError('');
      setDetailList([]);

      try {
        const { data, error: dErr } = await supabase
          .from('estimate_details')
          .select('*')
          .eq('estimate_id', selectedEstimate.id)
          .order('created_at');

        if (dErr) throw dErr;
        if (!alive) return;

        setDetailList(data || []);
      } catch (e) {
        if (!alive) return;
        setError(e?.message || '明細の取得に失敗しました');
      } finally {
        if (alive) setDetailsLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [selectedEstimate?.id]);

  /** 明細から手順票の初期値を補完（サイズ/数量/頁/色/用紙/チェック等） */
  useEffect(() => {
    if (detailsLoading) return;
    if (!selectedEstimate?.id) return;
    if (!detailList.length) return;

    const d0 = detailList[0];
    const cover = detailList.find((d) => d.detail_type === '表紙') || null;
    const body = detailList.find((d) => d.detail_type === '本文') || null;
    const general =
      detailList.find((d) => d.detail_type === '指定無し' || d.detail_type === '表紙＋本文') || null;

    const anyDesignIn = detailList.some((d) => d.design_type === 'inhouse');
    const anyDesignOut = detailList.some((d) => d.design_type === 'outsourced');
    const anyPrintIn = detailList.some((d) => d.print_type === 'inhouse');
    const anyPrintOut = detailList.some((d) => d.print_type === 'outsourced');
    const hasVP = detailList.some((d) => d.machine === 'VP');
    const hasGTO = detailList.some((d) => d.machine === 'GTO');
    const hasOD = detailList.some((d) => d.machine === 'オンデマンド');

    setManual((p) => ({
      ...p,
      size: p.size || d0.size || '',
      quantity: p.quantity || (d0.quantity != null ? String(d0.quantity) : ''),
      pages: p.pages || (d0.pages != null ? String(d0.pages) : ''),
      colorCount: p.colorCount || (d0.colors != null ? String(d0.colors) : ''),
      detailType: p.detailType || (d0.detail_type || ''),

      paper_general_type: p.paper_general_type || (general?.paper_type ?? ''),
      paper_general_thickness: p.paper_general_thickness || (general?.paper_thickness ?? ''),
      paper_general_needed: p.paper_general_needed || (general?.needed_paper ?? ''),

      paper_cover_type: p.paper_cover_type || (cover?.paper_type ?? ''),
      paper_cover_thickness: p.paper_cover_thickness || (cover?.paper_thickness ?? ''),
      paper_cover_needed: p.paper_cover_needed || (cover?.needed_paper ?? ''),

      paper_body_type: p.paper_body_type || (body?.paper_type ?? ''),
      paper_body_thickness: p.paper_body_thickness || (body?.paper_thickness ?? ''),
      paper_body_needed: p.paper_body_needed || (body?.needed_paper ?? ''),

      bookMemo: p.bookMemo || (d0.binding_method || ''),

      designInhouse: p.designInhouse || anyDesignIn,
      designOutsource: p.designOutsource || anyDesignOut,
      printInhouse: p.printInhouse || anyPrintIn,
      printOutsource: p.printOutsource || anyPrintOut,
      mVP: p.mVP || hasVP,
      mGTO: p.mGTO || hasGTO,
      mOD: p.mOD || hasOD,
    }));
  }, [detailsLoading, selectedEstimate?.id, detailList]);

  /* ───────── 5) 金額の集計（表紙/本文/一般に分ける） ───────── */
  const sums = useMemo(() => {
    // 数値化（null/undefined/NaN を 0 扱い）
    const n = (v) => {
      const x = Number(v);
      return Number.isFinite(x) ? x : 0;
    };

    // 汎用 sum（getter で取り出した値を合算）
    const sumBy = (arr, getter) => (arr || []).reduce((a, d) => a + n(getter(d)), 0);

    // detail_type の分類（EstimateForm の入力値に合わせる）
    const cover = detailList.filter((d) => d.detail_type === '表紙');
    const body = detailList.filter((d) => d.detail_type === '本文');
    const general = detailList.filter(
      (d) => d.detail_type === '指定無し' || d.detail_type === '表紙＋本文'
    );

    // ★ここが重要：印刷代は「現行=print_cost」。古いDBが混在しても動くようにフォールバックを入れる
    const getPrintCost = (d) => {
      // 現行（EstimateForm.jsx で insert している）
      if (d?.print_cost != null) return d.print_cost;

      // 旧仕様互換（過去データが残っている場合）
      if (d?.actual_print_cost != null) return d.actual_print_cost;

      return 0;
    };

    // ★デザイン費も同様に互換（現行=design_cost）
    const getDesignCost = (d) => {
      if (d?.design_cost != null) return d.design_cost;
      if (d?.total_design_cost != null) return d.total_design_cost; // 旧互換
      return 0;
    };

    return {
      // 用紙
      paper_general: sumBy(general, (d) => d.paper_cost),
      paper_cover: sumBy(cover, (d) => d.paper_cost),
      paper_body: sumBy(body, (d) => d.paper_cost),

      // 製版
      plate_general: sumBy(general, (d) => d.plate_cost),
      plate_cover: sumBy(cover, (d) => d.plate_cost),
      plate_body: sumBy(body, (d) => d.plate_cost),

      // ★印刷（ここを print_cost にする）
      print_general: sumBy(general, getPrintCost),
      print_cover: sumBy(cover, getPrintCost),
      print_body: sumBy(body, getPrintCost),

      // 製本・発送（EstimateForm のカラムそのまま）
      bind_general: sumBy(general, (d) => d.binding_cost),
      bind_cover: sumBy(cover, (d) => d.binding_cost),
      bind_body: sumBy(body, (d) => d.binding_cost),

      ship_general: sumBy(general, (d) => d.shipping_cost),
      ship_cover: sumBy(cover, (d) => d.shipping_cost),
      ship_body: sumBy(body, (d) => d.shipping_cost),

      // ★デザイン（現行=design_cost）
      design_total: sumBy(detailList, getDesignCost),
    };
  }, [detailList]);

  /** 右カラム：自動計算値 */
  const rightCol = useMemo(() => {
    return {
      paper_general: sums.paper_general,
      paper_cover: sums.paper_cover,
      paper_body: sums.paper_body,

      plate1: sums.plate_general + sums.plate_cover,
      plate2: sums.plate_body,

      print1: sums.print_general + sums.print_cover,
      print2: sums.print_body,

      bind1: sums.bind_general + sums.bind_cover,
      bind2: sums.bind_body,

      ship1: sums.ship_general + sums.ship_cover,
      ship2: sums.ship_body,

      design: sums.design_total,
    };
  }, [sums]);

  /** 金額文字列：明細ロード完了後に（未編集の場合のみ）自動注入 */
  useEffect(() => {
    if (!selectedEstimate?.id) return;
    if (detailsLoading) return;
    if (amountDirty) return;

    setAmountOverrideStr({
      design: yen(rightCol.design),
      paper_general: yen(rightCol.paper_general),
      paper_cover: yen(rightCol.paper_cover),
      paper_body: yen(rightCol.paper_body),
      plate1: yen(rightCol.plate1),
      plate2: yen(rightCol.plate2),
      print1: yen(rightCol.print1),
      print2: yen(rightCol.print2),
      bind1: yen(rightCol.bind1),
      bind2: yen(rightCol.bind2),
      ship1: yen(rightCol.ship1),
      ship2: yen(rightCol.ship2),
    });
  }, [selectedEstimate?.id, detailsLoading, amountDirty, rightCol]);

  /** 計算用：数値化した最終額 */
  const usedAmt = useMemo(() => {
    return {
      design: parseAmountLike(amountOverrideStr.design),
      paper_general: parseAmountLike(amountOverrideStr.paper_general),
      paper_cover: parseAmountLike(amountOverrideStr.paper_cover),
      paper_body: parseAmountLike(amountOverrideStr.paper_body),
      plate1: parseAmountLike(amountOverrideStr.plate1),
      plate2: parseAmountLike(amountOverrideStr.plate2),
      print1: parseAmountLike(amountOverrideStr.print1),
      print2: parseAmountLike(amountOverrideStr.print2),
      bind1: parseAmountLike(amountOverrideStr.bind1),
      bind2: parseAmountLike(amountOverrideStr.bind2),
      ship1: parseAmountLike(amountOverrideStr.ship1),
      ship2: parseAmountLike(amountOverrideStr.ship2),
    };
  }, [amountOverrideStr]);

  const rightSum = useMemo(() => {
    return (
      usedAmt.design +
      usedAmt.paper_general +
      usedAmt.paper_cover +
      usedAmt.paper_body +
      usedAmt.plate1 +
      usedAmt.plate2 +
      usedAmt.print1 +
      usedAmt.print2 +
      usedAmt.bind1 +
      usedAmt.bind2 +
      usedAmt.ship1 +
      usedAmt.ship2
    );
  }, [usedAmt]);

  const qtyForUnit = useMemo(() => parseAmountLike(manual.quantity), [manual.quantity]);

  const autoGrand = useMemo(() => {
    const total = rightSum;
    const unit = qtyForUnit > 0 ? Math.round(total / qtyForUnit) : 0;
    const bill = total;
    const tax = Math.floor(bill * 0.1);
    return { unit, total, bill, tax };
  }, [rightSum, qtyForUnit]);

  // 自動値注入（未手動のみ）
  useEffect(() => {
    if (!selectedEstimate?.id) return;

    setGrandText((prev) => {
      const next = { ...prev };

      if (!grandDirty.total) next.total = yen(autoGrand.total); // 請求額
      if (!grandDirty.unit) next.unit = yen(autoGrand.unit); // 単価

      const baseForTax = grandDirty.total ? parseAmountLike(prev.total) : autoGrand.total;
      if (!grandDirty.tax) next.tax = yen(Math.floor(baseForTax * 0.1));

      if (!grandDirty.total2) next.total2 = grandDirty.total ? prev.total : yen(autoGrand.total);

      return next;
    });
  }, [selectedEstimate?.id, autoGrand, grandDirty]);

  const onGrandChange = (key) => (e) => {
    const v = e.target.value;
    setGrandText((t) => {
      const next = { ...t, [key]: v };
      if (key === 'total') {
        if (!grandDirty.tax) {
          const base = parseAmountLike(v);
          next.tax = yen(Math.floor(base * 0.1));
        }
        if (!grandDirty.total2) next.total2 = v;
      }
      return next;
    });
    setGrandDirty((d) => ({ ...d, [key]: true }));
  };

  /** 版・印刷の表示 */
  const plateStrings = useMemo(() => {
    const vp = detailList.filter((d) => d.machine === 'VP').map(getPlateString);
    const gto = detailList.filter((d) => d.machine === 'GTO').map(getPlateString);
    return { vp, gto };
  }, [detailList]);

  const printStrings = useMemo(() => {
    const vp = detailList.filter((d) => d.machine === 'VP').map(getPrintString);
    const gto = detailList.filter((d) => d.machine === 'GTO').map(getPrintString);
    const od = detailList.filter((d) => d.machine === 'オンデマンド').map(getPrintString);
    return { vp, gto, od };
  }, [detailList]);

  // 未編集の場合のみ自動注入（明細ロード完了後）
  useEffect(() => {
    if (!selectedEstimate?.id) return;
    if (detailsLoading) return;
    if (linesDirty) return;

    setLinesOverride({
      plateVP: `VP・・・・・・${plateStrings.vp.join('、')}`,
      plateGTO: `GTO・・・・・${plateStrings.gto.join('、')}`,
      printVP: `VP・・・・・・${printStrings.vp.join('、')}`,
      printGTO: `GTO・・・・・${printStrings.gto.join('、')}`,
      printOD: `オンデマンド・・${printStrings.od.join('、')}`,
    });
  }, [selectedEstimate?.id, detailsLoading, linesDirty, plateStrings, printStrings]);

  /** ---------- 入力ハンドラ ---------- */
  const onManualChange = (e) => {
    const { name, value } = e.target;
    setManual((p) => ({ ...p, [name]: value }));
  };
  const toggle = (key) => setManual((p) => ({ ...p, [key]: !p[key] }));

  const updateScheduleRow = (idx, patch) => {
    setManual((p) => {
      const arr = [...p.schedule];
      arr[idx] = { ...arr[idx], ...patch };
      return { ...p, schedule: arr };
    });
  };

  const renderScheduleFor = (startY = 150, step = 95, xDate = 612, xText = 660) =>
    manual.schedule.map((row, i) => {
      const y = startY + i * step;
      return (
        <React.Fragment key={i}>
          <OVInput
            x={xDate}
            y={y}
            w={40}
            name={`schedule_date_${i}`}
            value={row.date}
            onChange={(e) => updateScheduleRow(i, { date: e.target.value })}
          />
          <OVInput
            x={xText}
            y={y}
            w={90}
            name={`schedule_text_${i}`}
            value={row.text}
            onChange={(e) => updateScheduleRow(i, { text: e.target.value })}
          />
        </React.Fragment>
      );
    });

  /** =========================================================
   *  PDF保存（html2canvas + jsPDF）
   *  - set1: 手順票 + 工程表（複数ページ可）
   *  - ledger: 得意先元帳のみ（A4 1ページに収める）
   * ========================================================= */
  const exportNodeToPdf = useCallback(async (node, fileBase, options = {}) => {
    if (!node) return;
    const { fitOnePage = false } = options;

    // caret（入力カーソル）を消す
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
      await new Promise((r) => setTimeout(r, 0));
    }

    const canvas = await html2canvas(node, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      windowWidth: node.clientWidth || node.scrollWidth,
      windowHeight: node.scrollHeight,
      scrollY: 0,
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = pdf.internal.pageSize.getHeight();

    // デフォ：幅フィット
    let imgW = pdfW;
    let imgH = (canvas.height * imgW) / canvas.width;

    const date = new Date().toISOString().slice(0, 10);

    if (fitOnePage) {
      // A4幅/高さの両方に収める縮尺で中央配置
      const ratio = Math.min(pdfW / canvas.width, pdfH / canvas.height);
      imgW = canvas.width * ratio;
      imgH = canvas.height * ratio;

      const offsetX = (pdfW - imgW) / 2;
      const offsetY = (pdfH - imgH) / 2;

      pdf.addImage(imgData, 'PNG', offsetX, offsetY, imgW, imgH);
      pdf.save(`${fileBase}_${date}.pdf`);
      return;
    }

    // 複数ページ分割
    let position = 0;
    let heightLeft = imgH;

    pdf.addImage(imgData, 'PNG', 0, position, imgW, imgH);
    heightLeft -= pdfH;

    while (heightLeft > 0) {
      position -= pdfH;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgW, imgH);
      heightLeft -= pdfH;
    }

    pdf.save(`${fileBase}_${date}.pdf`);
  }, []);

  const resolveSerialToUse = useCallback(async () => {
    // serialNo が未入力なら localStorage の next を採用
    const digits = String(serialNo || '').replace(/[^\d]/g, '');
    let used = digits.length ? pad6(digits) : '';

    if (!used) {
      let seqNow = Number(localStorage.getItem(SERIAL_NEXT_KEY) || '1');
      if (!Number.isFinite(seqNow) || seqNow < 1) seqNow = 1;
      used = pad6(seqNow);
    }

    // 表示と一致させる（印字がズレないように）
    if (used !== pad6(serialNo)) {
      setSerialNo(used);
      await new Promise((r) => setTimeout(r, 0));
    }
    return used;
  }, [serialNo]);

  const afterExport = useCallback(
    (kind, serialUsed) => {
      setExportFlags((prev) => {
        const base =
          prev.serial === serialUsed ? prev : { serial: serialUsed, set1: false, ledger: false };

        const next = { ...base, [kind]: true };

        // 2つ揃ったら次番号へ
        if (next.set1 && next.ledger) {
          bumpSerialNext(serialUsed);
          return { serial: '', set1: false, ledger: false };
        }
        return next;
      });
    },
    [bumpSerialNext]
  );

  const productCode = selectedEstimate?.product?.product_code || selectedEstimate?.title || '';
  const productName = selectedEstimate?.product?.name || '';
  const estimateId = selectedEstimate?.id || '';
  const deliveryFactory = selectedEstimate?.delivery_factory || '';
  const orderNo = selectedEstimate?.kawasaki_order_no || '';

  const downloadSetOnePdf = useCallback(async () => {
    if (!selectedEstimate?.id) return;
    if (!setOneRef.current) return;

    setBusy(true);
    setError('');
    try {
      const serialUsed = await resolveSerialToUse();
      const safeProd = sanitizeFileName(productCode || productName || '品名');
      const base = `${serialUsed}_${sanitizeFileName(estimateId)}_${safeProd}_set1`;
      await exportNodeToPdf(setOneRef.current, base, { fitOnePage: false });
      afterExport('set1', serialUsed);
    } catch (e) {
      setError(e?.message || 'PDF保存に失敗しました');
    } finally {
      setBusy(false);
    }
  }, [selectedEstimate?.id, resolveSerialToUse, productCode, productName, estimateId, exportNodeToPdf, afterExport]);

  const downloadLedgerPdf = useCallback(async () => {
    if (!selectedEstimate?.id) return;
    if (!ledgerRef.current) return;

    setBusy(true);
    setError('');
    try {
      const serialUsed = await resolveSerialToUse();
      const safeProd = sanitizeFileName(productCode || productName || '品名');
      const base = `${serialUsed}_${sanitizeFileName(estimateId)}_${safeProd}_ledger`;
      await exportNodeToPdf(ledgerRef.current, base, { fitOnePage: true });
      afterExport('ledger', serialUsed);
    } catch (e) {
      setError(e?.message || 'PDF保存に失敗しました');
    } finally {
      setBusy(false);
    }
  }, [selectedEstimate?.id, resolveSerialToUse, productCode, productName, estimateId, exportNodeToPdf, afterExport]);

  /** =========================================================
   *  UI
   * ========================================================= */
  return (
    <RequireRole allow={['staff', 'admin']}>
      <Box sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Typography variant="h5" fontWeight={900}>
            伝票作成（社内）
          </Typography>

          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            手順票の入力を起点に、工程表・売上伝票・得意先元帳へ内容を連動させます。PDFは「手順票＋工程表」と「得意先元帳」の2点を保存します。
          </Typography>

          {error && <Alert severity="error">{error}</Alert>}

          {/* 選択 + 操作 */}
          <Paper sx={{ p: 2 }}>
            <Stack spacing={2}>
              <Typography fontWeight={900}>対象見積を選択</Typography>

              {loading ? (
                <Typography sx={{ color: 'text.secondary' }}>読み込み中…</Typography>
              ) : (
                <FormControl sx={{ minWidth: 340 }}>
                  <InputLabel id="estimate-select-label">品番（見積）</InputLabel>
                  <Select
                    labelId="estimate-select-label"
                    label="品番（見積）"
                    value={selectedEstimateId}
                    onChange={(e) => setSelectedEstimateId(e.target.value)}
                  >
                    <MenuItem value="">
                      <em>選択してください</em>
                    </MenuItem>
                    {estimates.map((est) => {
                      const code = est.product?.product_code || est.title || '';
                      const name = est.product?.name ? ` / ${est.product.name}` : '';
                      return (
                        <MenuItem key={est.id} value={est.id}>
                          {code}
                          {name}
                        </MenuItem>
                      );
                    })}
                  </Select>
                </FormControl>
              )}

              {selectedEstimate && (
                <>
                  <Divider />

                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                    <TextField
                      label="伝票番号（6桁）"
                      value={serialNo}
                      onChange={onSerialTextChange}
                      onBlur={onSerialTextBlur}
                      placeholder="000001"
                      sx={{ maxWidth: 220 }}
                      inputProps={{ inputMode: 'numeric' }}
                    />
                    <TextField
                      label="見積ID（UUID）"
                      value={estimateId}
                      InputProps={{ readOnly: true }}
                      sx={{ flex: 1 }}
                    />
                  </Stack>

                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                    <TextField
                      label="得意先（固定）"
                      value={KAWASAKI_CLIENT_NAME}
                      InputProps={{ readOnly: true }}
                      sx={{ flex: 1 }}
                    />
                    <TextField
                      label="納品工場 / 注文番号（見積入力値）"
                      value={`${factoryLabel(deliveryFactory) || '未設定'} / ${orderNo || '未設定'}`}
                      InputProps={{ readOnly: true }}
                      sx={{ flex: 1 }}
                    />
                  </Stack>

                  <Divider />

                  <Stack direction="row" spacing={1} flexWrap="wrap">
                    <Button
                      variant="contained"
                      onClick={downloadSetOnePdf}
                      disabled={busy || detailsLoading || !selectedEstimate?.id}
                    >
                      {busy ? '処理中…' : '手順票＋工程表 をPDF保存'}
                    </Button>

                    <Button
                      variant="contained"
                      onClick={downloadLedgerPdf}
                      disabled={busy || detailsLoading || !selectedEstimate?.id}
                    >
                      {busy ? '処理中…' : '得意先元帳 をPDF保存'}
                    </Button>
                  </Stack>

                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    補足：2点のPDF保存が完了すると、伝票番号は自動で次へ進みます（同一番号で揃えるため）。
                  </Typography>
                </>
              )}
            </Stack>
          </Paper>

          {/* プレビュー */}
          {!selectedEstimate ? (
            <Paper sx={{ p: 2 }}>
              <Typography sx={{ color: 'text.secondary' }}>
                見積を選択すると、手順票〜得意先元帳の4伝票が表示されます（赤字は編集できます）。
              </Typography>
            </Paper>
          ) : (
            <Paper sx={{ p: 2 }}>
              <Stack spacing={1}>
                <Typography fontWeight={900}>伝票プレビュー（編集可）</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  画面上の赤字入力（テキスト）を編集すると、4伝票に同じ内容が反映されます。
                </Typography>

                {detailsLoading && (
                  <Alert severity="info">明細を読み込み中です（ロード完了後に金額・版・印刷行が自動反映されます）</Alert>
                )}

                <Box
                  sx={{
                    overflow: 'auto',
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    p: 2,
                    bgcolor: 'background.default',
                  }}
                >
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' },
                      gap: 2,
                      alignItems: 'start',
                    }}
                  >
                    {/* ================= 左：手順票 + 工程表 ================= */}
                    <div ref={setOneRef}>
                      {/* 手順票 */}
                      <OverlayImage src={IMG_TEJUN} width={BASE_W} height={BASE_H_FORM} style={{ marginBottom: 16 }}>
                        {/* ヘッダ（見積IDと伝票番号） */}
                        <OVInput x={15} y={31} w={180} name="estimateId_head" value={estimateId} readOnly fontSize={9} />
                        <OVInput
                          x={205}
                          y={31}
                          w={90}
                          name="serial_head"
                          value={serialNo}
                          onChange={onSerialTextChange}
                          onBlur={onSerialTextBlur}
                          fontSize={10}
                          align="center"
                        />
                        <OVInput x={340} y={15} w={260} name="clientName_head" value={KAWASAKI_CLIENT_NAME} readOnly fontSize={17} />
                        <OVInput x={340} y={65} w={260} name="productName_head" value={productCode} readOnly fontSize={16} />

                        {/* 左：基本仕様（編集可） */}
                        <OVInput x={80} y={118} w={100} name="dueDate" value={manual.dueDate} onChange={onManualChange} fontSize={20} />
                        <OVInput x={100} y={169} w={160} name="size" value={manual.size} onChange={onManualChange} fontSize={24} />
                        <OVInput x={100} y={220} w={160} name="quantity" value={manual.quantity} onChange={onManualChange} fontSize={20} />
                        <OVInput x={120} y={272} w={160} name="pages" value={manual.pages} onChange={onManualChange} fontSize={20} />
                        <OVInput x={100} y={328} w={160} name="colorCount" value={manual.colorCount} onChange={onManualChange} fontSize={24} />

                        {/* 片面/両面・新規/増刷 */}
                        <OVCheck x={79} y={372} value={manual.isSingle} onToggle={() => toggle('isSingle')} />
                        <OVCheck x={79} y={395} value={manual.isDouble} onToggle={() => toggle('isDouble')} />
                        <OVCheck x={79} y={426.5} value={manual.isNew} onToggle={() => toggle('isNew')} />
                        <OVCheck x={79} y={449.5} value={manual.isReprint} onToggle={() => toggle('isReprint')} />

                        {/* 用紙欄 */}
                        <OVInput x={265} y={134} w={100} name="paper_general_type" value={manual.paper_general_type} onChange={onManualChange} />
                        <OVInput x={395} y={134} w={60} name="paper_general_thickness" value={manual.paper_general_thickness} onChange={onManualChange} align="center" />
                        <OVInput x={460} y={134} w={80} name="paper_general_needed" value={manual.paper_general_needed} onChange={onManualChange} align="right" />

                        <OVInput x={265} y={197} w={100} name="paper_cover_type" value={manual.paper_cover_type} onChange={onManualChange} />
                        <OVInput x={395} y={197} w={60} name="paper_cover_thickness" value={manual.paper_cover_thickness} onChange={onManualChange} align="center" />
                        <OVInput x={460} y={197} w={80} name="paper_cover_needed" value={manual.paper_cover_needed} onChange={onManualChange} align="right" />

                        <OVInput x={265} y={265} w={100} name="paper_body_type" value={manual.paper_body_type} onChange={onManualChange} />
                        <OVInput x={395} y={265} w={60} name="paper_body_thickness" value={manual.paper_body_thickness} onChange={onManualChange} align="center" />
                        <OVInput x={460} y={265} w={80} name="paper_body_needed" value={manual.paper_body_needed} onChange={onManualChange} align="right" />

                        {/* 制作メモなど */}
                        <OVCheck x={79} y={519} value={manual.designInhouse} onToggle={() => toggle('designInhouse')} />
                        <OVCheck x={79} y={542} value={manual.designOutsource} onToggle={() => toggle('designOutsource')} />
                        <OVInput x={225} y={534} w={405} h={30} name="designMemo" value={manual.designMemo} onChange={onManualChange} fontSize={15} />

                        {/* 印刷チェック */}
                        <OVCheck x={79} y={621} value={manual.printInhouse} onToggle={() => toggle('printInhouse')} />
                        <OVCheck x={79} y={643.8} value={manual.printOutsource} onToggle={() => toggle('printOutsource')} />
                        <OVCheck x={312} y={632} value={manual.mVP} onToggle={() => toggle('mVP')} />
                        <OVCheck x={359} y={632} value={manual.mGTO} onToggle={() => toggle('mGTO')} />
                        <OVCheck x={417} y={632} value={manual.mOD} onToggle={() => toggle('mOD')} />

                        {/* 外注メモ（複数行） */}
                        <OVInput x={30} y={712} w={170} h={48} name="outsideMemo" value={manual.outsideMemo} onChange={onManualChange} />
                        <OVInput x={30} y={735} w={170} h={48} name="outsideMemo2" value={manual.outsideMemo2} onChange={onManualChange} />
                        <OVInput x={30} y={760} w={170} h={48} name="outsideMemo3" value={manual.outsideMemo3} onChange={onManualChange} />

                        {/* 版・印刷の行（編集可） */}
                        <OVInput
                          x={250}
                          y={725}
                          w={420}
                          name="plateVP_line"
                          value={linesOverride.plateVP}
                          onChange={(e) => {
                            setLinesDirty(true);
                            setLinesOverride((p) => ({ ...p, plateVP: e.target.value }));
                          }}
                        />
                        <OVInput
                          x={250}
                          y={744}
                          w={420}
                          name="plateGTO_line"
                          value={linesOverride.plateGTO}
                          onChange={(e) => {
                            setLinesDirty(true);
                            setLinesOverride((p) => ({ ...p, plateGTO: e.target.value }));
                          }}
                        />
                        <OVInput
                          x={250}
                          y={835}
                          w={420}
                          name="printVP_line"
                          value={linesOverride.printVP}
                          onChange={(e) => {
                            setLinesDirty(true);
                            setLinesOverride((p) => ({ ...p, printVP: e.target.value }));
                          }}
                        />
                        <OVInput
                          x={250}
                          y={860}
                          w={420}
                          name="printGTO_line"
                          value={linesOverride.printGTO}
                          onChange={(e) => {
                            setLinesDirty(true);
                            setLinesOverride((p) => ({ ...p, printGTO: e.target.value }));
                          }}
                        />
                        <OVInput
                          x={250}
                          y={885}
                          w={420}
                          name="printOD_line"
                          value={linesOverride.printOD}
                          onChange={(e) => {
                            setLinesDirty(true);
                            setLinesOverride((p) => ({ ...p, printOD: e.target.value }));
                          }}
                        />

                        {/* 製本 */}
                        <OVCheck x={79} y={983} value={manual.bindInhouse} onToggle={() => toggle('bindInhouse')} />
                        <OVCheck x={79} y={1006} value={manual.bindOutsource} onToggle={() => toggle('bindOutsource')} />
                        <OVInput x={245} y={1010} w={360} h={30} name="bookMemo" value={manual.bookMemo} onChange={onManualChange} />
                        <OVInput x={245} y={1035} w={360} h={30} name="bookMemo2" value={manual.bookMemo2} onChange={onManualChange} />
                        <OVInput x={245} y={1065} w={360} h={30} name="bookMemo3" value={manual.bookMemo3} onChange={onManualChange} />
                        <OVInput x={30} y={1056} w={170} h={48} name="outsideMemo4" value={manual.outsideMemo4} onChange={onManualChange} />

                        {/* スケジュール（右端） */}
                        {renderScheduleFor(150, 55, 630, 672)}
                      </OverlayImage>

                      {/* 工程表 */}
                      <OverlayImage src={IMG_KOUTEI} width={BASE_W} height={BASE_H_FORM}>
                        <OVInput x={15} y={31} w={180} name="estimateId_k" value={estimateId} readOnly fontSize={9} />
                        <OVInput
                          x={205}
                          y={31}
                          w={90}
                          name="serial_k"
                          value={serialNo}
                          onChange={onSerialTextChange}
                          onBlur={onSerialTextBlur}
                          fontSize={10}
                          align="center"
                        />
                        <OVInput x={340} y={15} w={260} name="clientName_k" value={KAWASAKI_CLIENT_NAME} readOnly fontSize={17} />
                        <OVInput x={340} y={65} w={260} name="productName_k" value={productCode} readOnly fontSize={16} />

                        <OVInput x={80} y={118} w={140} name="dueDate_k" value={manual.dueDate} onChange={onManualChange} fontSize={20} />
                        <OVInput x={100} y={169} w={160} name="size_k" value={manual.size} onChange={onManualChange} fontSize={24} />
                        <OVInput x={100} y={220} w={160} name="quantity_k" value={manual.quantity} onChange={onManualChange} fontSize={20} />
                        <OVInput x={120} y={272} w={160} name="pages_k" value={manual.pages} onChange={onManualChange} fontSize={20} />
                        <OVInput x={100} y={328} w={160} name="colorCount_k" value={manual.colorCount} onChange={onManualChange} fontSize={24} />

                        <OVCheck x={79} y={372} value={manual.isSingle} onToggle={() => toggle('isSingle')} />
                        <OVCheck x={79} y={395} value={manual.isDouble} onToggle={() => toggle('isDouble')} />
                        <OVCheck x={79} y={426.5} value={manual.isNew} onToggle={() => toggle('isNew')} />
                        <OVCheck x={79} y={449.5} value={manual.isReprint} onToggle={() => toggle('isReprint')} />

                        <OVInput x={265} y={134} w={100} name="paper_general_type_k" value={manual.paper_general_type} onChange={onManualChange} />
                        <OVInput x={395} y={134} w={60} name="paper_general_thickness_k" value={manual.paper_general_thickness} onChange={onManualChange} align="center" />
                        <OVInput x={460} y={134} w={80} name="paper_general_needed_k" value={manual.paper_general_needed} onChange={onManualChange} align="right" />

                        <OVInput x={265} y={197} w={100} name="paper_cover_type_k" value={manual.paper_cover_type} onChange={onManualChange} />
                        <OVInput x={395} y={197} w={60} name="paper_cover_thickness_k" value={manual.paper_cover_thickness} onChange={onManualChange} align="center" />
                        <OVInput x={460} y={197} w={80} name="paper_cover_needed_k" value={manual.paper_cover_needed} onChange={onManualChange} align="right" />

                        <OVInput x={265} y={265} w={100} name="paper_body_type_k" value={manual.paper_body_type} onChange={onManualChange} />
                        <OVInput x={395} y={265} w={60} name="paper_body_thickness_k" value={manual.paper_body_thickness} onChange={onManualChange} align="center" />
                        <OVInput x={460} y={265} w={80} name="paper_body_needed_k" value={manual.paper_body_needed} onChange={onManualChange} align="right" />

                        <OVCheck x={79} y={519} value={manual.designInhouse} onToggle={() => toggle('designInhouse')} />
                        <OVCheck x={79} y={542} value={manual.designOutsource} onToggle={() => toggle('designOutsource')} />
                        <OVInput x={225} y={534} w={405} h={30} name="designMemo_k" value={manual.designMemo} onChange={onManualChange} />

                        <OVCheck x={79} y={621} value={manual.printInhouse} onToggle={() => toggle('printInhouse')} />
                        <OVCheck x={79} y={643.8} value={manual.printOutsource} onToggle={() => toggle('printOutsource')} />
                        <OVCheck x={312} y={632} value={manual.mVP} onToggle={() => toggle('mVP')} />
                        <OVCheck x={359} y={632} value={manual.mGTO} onToggle={() => toggle('mGTO')} />
                        <OVCheck x={417} y={632} value={manual.mOD} onToggle={() => toggle('mOD')} />

                        <OVInput
                          x={250}
                          y={725}
                          w={420}
                          name="plateVP_line_k"
                          value={linesOverride.plateVP}
                          onChange={(e) => {
                            setLinesDirty(true);
                            setLinesOverride((p) => ({ ...p, plateVP: e.target.value }));
                          }}
                        />
                        <OVInput
                          x={250}
                          y={744}
                          w={420}
                          name="plateGTO_line_k"
                          value={linesOverride.plateGTO}
                          onChange={(e) => {
                            setLinesDirty(true);
                            setLinesOverride((p) => ({ ...p, plateGTO: e.target.value }));
                          }}
                        />
                        <OVInput
                          x={250}
                          y={835}
                          w={420}
                          name="printVP_line_k"
                          value={linesOverride.printVP}
                          onChange={(e) => {
                            setLinesDirty(true);
                            setLinesOverride((p) => ({ ...p, printVP: e.target.value }));
                          }}
                        />
                        <OVInput
                          x={250}
                          y={860}
                          w={420}
                          name="printGTO_line_k"
                          value={linesOverride.printGTO}
                          onChange={(e) => {
                            setLinesDirty(true);
                            setLinesOverride((p) => ({ ...p, printGTO: e.target.value }));
                          }}
                        />
                        <OVInput
                          x={250}
                          y={885}
                          w={420}
                          name="printOD_line_k"
                          value={linesOverride.printOD}
                          onChange={(e) => {
                            setLinesDirty(true);
                            setLinesOverride((p) => ({ ...p, printOD: e.target.value }));
                          }}
                        />

                        <OVCheck x={79} y={983} value={manual.bindInhouse} onToggle={() => toggle('bindInhouse')} />
                        <OVCheck x={79} y={1006} value={manual.bindOutsource} onToggle={() => toggle('bindOutsource')} />
                        <OVInput x={245} y={1010} w={360} h={30} name="bookMemo_k" value={manual.bookMemo} onChange={onManualChange} />
                        <OVInput x={245} y={1035} w={360} h={30} name="bookMemo2_k" value={manual.bookMemo2} onChange={onManualChange} />
                        <OVInput x={245} y={1065} w={360} h={30} name="bookMemo3_k" value={manual.bookMemo3} onChange={onManualChange} />
                        <OVInput x={30} y={1056} w={170} h={48} name="outsideMemo4_k" value={manual.outsideMemo4} onChange={onManualChange} />

                        {renderScheduleFor(153, 105, 635, 680)}
                      </OverlayImage>
                    </div>

                    {/* ================= 右：売上伝票 + 得意先元帳 ================= */}
                    <div>
                      {/* 売上伝票 */}
                      <OverlayImage src={IMG_URIAGE} width={BASE_W} height={BASE_H_SLIP} style={{ marginBottom: 16 }}>
                        <OVInput x={12} y={31} w={185} name="estimateId_u" value={estimateId} readOnly fontSize={10} />
                        <OVInput
                          x={205}
                          y={31}
                          w={90}
                          name="serial_u"
                          value={serialNo}
                          onChange={onSerialTextChange}
                          onBlur={onSerialTextBlur}
                          fontSize={10}
                          align="center"
                        />
                        <OVInput x={340} y={15} w={260} name="clientName_u" value={KAWASAKI_CLIENT_NAME} readOnly fontSize={17} />
                        <OVInput x={340} y={65} w={260} name="productName_u" value={productCode} readOnly fontSize={16} />

                        {/* 左側基本（編集可） */}
                        <OVInput x={90} y={115} w={140} name="dueDate_u" value={manual.dueDate} onChange={onManualChange} fontSize={20} />
                        <OVInput x={100} y={169} w={160} name="size_u" value={manual.size} onChange={onManualChange} fontSize={24} />
                        <OVInput x={100} y={220} w={160} name="quantity_u" value={manual.quantity} onChange={onManualChange} fontSize={20} />
                        <OVInput x={120} y={272} w={160} name="pages_u" value={manual.pages} onChange={onManualChange} fontSize={20} />
                        <OVInput x={100} y={328} w={160} name="colorCount_u" value={manual.colorCount} onChange={onManualChange} fontSize={24} />

                        <OVCheck x={79} y={371} value={manual.isSingle} onToggle={() => toggle('isSingle')} />
                        <OVCheck x={79} y={394} value={manual.isDouble} onToggle={() => toggle('isDouble')} />
                        <OVCheck x={79} y={425.5} value={manual.isNew} onToggle={() => toggle('isNew')} />
                        <OVCheck x={79} y={448.5} value={manual.isReprint} onToggle={() => toggle('isReprint')} />

                        {/* 用紙 */}
                        <OVInput x={265} y={134} w={100} name="paper_general_type_u" value={manual.paper_general_type} onChange={onManualChange} />
                        <OVInput x={395} y={134} w={60} name="paper_general_thickness_u" value={manual.paper_general_thickness} onChange={onManualChange} align="center" />
                        <OVInput x={460} y={134} w={80} name="paper_general_needed_u" value={manual.paper_general_needed} onChange={onManualChange} align="right" />

                        <OVInput x={265} y={197} w={100} name="paper_cover_type_u" value={manual.paper_cover_type} onChange={onManualChange} />
                        <OVInput x={395} y={197} w={60} name="paper_cover_thickness_u" value={manual.paper_cover_thickness} onChange={onManualChange} align="center" />
                        <OVInput x={460} y={197} w={80} name="paper_cover_needed_u" value={manual.paper_cover_needed} onChange={onManualChange} align="right" />

                        <OVInput x={265} y={265} w={100} name="paper_body_type_u" value={manual.paper_body_type} onChange={onManualChange} />
                        <OVInput x={395} y={265} w={60} name="paper_body_thickness_u" value={manual.paper_body_thickness} onChange={onManualChange} align="center" />
                        <OVInput x={460} y={265} w={80} name="paper_body_needed_u" value={manual.paper_body_needed} onChange={onManualChange} align="right" />

                        {/* 進行・印刷チェック */}
                        <OVInput x={225} y={534} w={390} h={30} name="designMemo_u" value={manual.designMemo} onChange={onManualChange} />
                        <OVCheck x={79} y={619} value={manual.printInhouse} onToggle={() => toggle('printInhouse')} />
                        <OVCheck x={79} y={641.8} value={manual.printOutsource} onToggle={() => toggle('printOutsource')} />
                        <OVCheck x={312} y={631} value={manual.mVP} onToggle={() => toggle('mVP')} />
                        <OVCheck x={359} y={631} value={manual.mGTO} onToggle={() => toggle('mGTO')} />
                        <OVCheck x={417} y={631} value={manual.mOD} onToggle={() => toggle('mOD')} />
                        <OVCheck x={79} y={518} value={manual.designInhouse} onToggle={() => toggle('designInhouse')} />
                        <OVCheck x={79} y={541} value={manual.designOutsource} onToggle={() => toggle('designOutsource')} />

                        {/* 外注先（3行） */}
                        <OVInput x={30} y={710} w={170} h={48} name="outsideMemo_u" value={manual.outsideMemo} onChange={onManualChange} />
                        <OVInput x={30} y={733} w={170} h={48} name="outsideMemo2_u" value={manual.outsideMemo2} onChange={onManualChange} />
                        <OVInput x={30} y={757} w={170} h={48} name="outsideMemo3_u" value={manual.outsideMemo3} onChange={onManualChange} />

                        {/* 行テキスト（編集可） */}
                        <OVInput x={250} y={720} w={420} name="plateVP_line_u" value={linesOverride.plateVP} onChange={(e) => { setLinesDirty(true); setLinesOverride((p) => ({ ...p, plateVP: e.target.value })); }} />
                        <OVInput x={250} y={744} w={420} name="plateGTO_line_u" value={linesOverride.plateGTO} onChange={(e) => { setLinesDirty(true); setLinesOverride((p) => ({ ...p, plateGTO: e.target.value })); }} />
                        <OVInput x={250} y={835} w={420} name="printVP_line_u" value={linesOverride.printVP} onChange={(e) => { setLinesDirty(true); setLinesOverride((p) => ({ ...p, printVP: e.target.value })); }} />
                        <OVInput x={250} y={860} w={420} name="printGTO_line_u" value={linesOverride.printGTO} onChange={(e) => { setLinesDirty(true); setLinesOverride((p) => ({ ...p, printGTO: e.target.value })); }} />
                        <OVInput x={250} y={885} w={420} name="printOD_line_u" value={linesOverride.printOD} onChange={(e) => { setLinesDirty(true); setLinesOverride((p) => ({ ...p, printOD: e.target.value })); }} />

                        <OVCheck x={79} y={981} value={manual.bindInhouse} onToggle={() => toggle('bindInhouse')} />
                        <OVCheck x={79} y={1003.5} value={manual.bindOutsource} onToggle={() => toggle('bindOutsource')} />
                        <OVInput x={245} y={1009} w={360} h={30} name="bookMemo_u" value={manual.bookMemo} onChange={onManualChange} />
                        <OVInput x={245} y={1033} w={360} h={30} name="bookMemo2_u" value={manual.bookMemo2} onChange={onManualChange} />
                        <OVInput x={245} y={1056} w={360} h={30} name="bookMemo3_u" value={manual.bookMemo3} onChange={onManualChange} />
                        <OVInput x={30} y={1053.5} w={170} h={48} name="outsideMemo4_u" value={manual.outsideMemo4} onChange={onManualChange} />

                        {/* 右カラム：金額（編集可） */}
                        <OVInput
                          x={640}
                          y={530}
                          w={110}
                          name="amt_design"
                          value={amountOverrideStr.design}
                          onChange={(e) => {
                            setAmountDirty(true);
                            setAmountOverrideStr((p) => ({ ...p, design: e.target.value }));
                          }}
                          align="right"
                        />

                        <OVInput x={640} y={180} w={110} name="amt_paper_general" value={amountOverrideStr.paper_general}
                          onChange={(e) => { setAmountDirty(true); setAmountOverrideStr((p) => ({ ...p, paper_general: e.target.value })); }}
                          align="right"
                        />
                        <OVInput x={640} y={300} w={110} name="amt_paper_cover" value={amountOverrideStr.paper_cover}
                          onChange={(e) => { setAmountDirty(true); setAmountOverrideStr((p) => ({ ...p, paper_cover: e.target.value })); }}
                          align="right"
                        />
                        <OVInput x={640} y={425} w={110} name="amt_paper_body" value={amountOverrideStr.paper_body}
                          onChange={(e) => { setAmountDirty(true); setAmountOverrideStr((p) => ({ ...p, paper_body: e.target.value })); }}
                          align="right"
                        />

                        <OVInput x={640} y={690} w={110} name="amt_plate1" value={amountOverrideStr.plate1}
                          onChange={(e) => { setAmountDirty(true); setAmountOverrideStr((p) => ({ ...p, plate1: e.target.value })); }}
                          align="right"
                        />
                        <OVInput x={640} y={720} w={110} name="amt_plate2" value={amountOverrideStr.plate2}
                          onChange={(e) => { setAmountDirty(true); setAmountOverrideStr((p) => ({ ...p, plate2: e.target.value })); }}
                          align="right"
                        />

                        <OVInput x={640} y={850} w={110} name="amt_print1" value={amountOverrideStr.print1}
                          onChange={(e) => { setAmountDirty(true); setAmountOverrideStr((p) => ({ ...p, print1: e.target.value })); }}
                          align="right"
                        />
                        <OVInput x={640} y={885} w={110} name="amt_print2" value={amountOverrideStr.print2}
                          onChange={(e) => { setAmountDirty(true); setAmountOverrideStr((p) => ({ ...p, print2: e.target.value })); }}
                          align="right"
                        />

                        <OVInput x={640} y={973} w={110} name="amt_bind1" value={amountOverrideStr.bind1}
                          onChange={(e) => { setAmountDirty(true); setAmountOverrideStr((p) => ({ ...p, bind1: e.target.value })); }}
                          align="right"
                        />
                        <OVInput x={640} y={995} w={110} name="amt_bind2" value={amountOverrideStr.bind2}
                          onChange={(e) => { setAmountDirty(true); setAmountOverrideStr((p) => ({ ...p, bind2: e.target.value })); }}
                          align="right"
                        />

                        <OVInput x={640} y={1058} w={110} name="amt_ship1" value={amountOverrideStr.ship1}
                          onChange={(e) => { setAmountDirty(true); setAmountOverrideStr((p) => ({ ...p, ship1: e.target.value })); }}
                          align="right"
                        />
                        <OVInput x={640} y={1079} w={110} name="amt_ship2" value={amountOverrideStr.ship2}
                          onChange={(e) => { setAmountDirty(true); setAmountOverrideStr((p) => ({ ...p, ship2: e.target.value })); }}
                          align="right"
                        />

                        {/* 下部：単価・請求額・消費税・合計金額 */}
                        <OVInput x={150} y={1117} w={200} name="grand_unit" value={grandText.unit} onChange={onGrandChange('unit')} align="center" />
                        <OVInput x={520} y={1117} w={200} name="grand_total" value={grandText.total} onChange={onGrandChange('total')} align="center" />
                        <OVInput x={520} y={1151} w={200} name="grand_tax" value={grandText.tax} onChange={onGrandChange('tax')} align="center" />
                        <OVInput x={170} y={1151} w={160} name="grand_total2" value={grandText.total2} onChange={onGrandChange('total2')} align="center" />
                      </OverlayImage>

                      {/* 得意先元帳（売上伝票と同じ state を共有） */}
                      <OverlayImage ref={ledgerRef} src={IMG_TOKUSAKI} width={BASE_W} height={BASE_H_SLIP}>
                        <OVInput x={12} y={31} w={185} name="estimateId_t" value={estimateId} readOnly fontSize={10} />
                        <OVInput
                          x={60}
                          y={15}
                          w={110}
                          name="serial_t"
                          value={serialNo}
                          onChange={onSerialTextChange}
                          onBlur={onSerialTextBlur}
                          fontSize={15}
                          align="center"
                        />
                        <OVInput x={340} y={15} w={260} name="clientName_t" value={KAWASAKI_CLIENT_NAME} readOnly fontSize={17} />
                        <OVInput x={340} y={65} w={260} name="productName_t" value={productCode} readOnly fontSize={16} />

                        {/* 左側基本 */}
                        <OVInput x={90} y={115} w={140} name="dueDate_t" value={manual.dueDate} onChange={onManualChange} fontSize={20} />
                        <OVInput x={100} y={169} w={160} name="size_t" value={manual.size} onChange={onManualChange} fontSize={24} />
                        <OVInput x={100} y={220} w={160} name="quantity_t" value={manual.quantity} onChange={onManualChange} fontSize={20} />
                        <OVInput x={120} y={272} w={160} name="pages_t" value={manual.pages} onChange={onManualChange} fontSize={20} />
                        <OVInput x={100} y={328} w={160} name="colorCount_t" value={manual.colorCount} onChange={onManualChange} fontSize={24} />

                        <OVCheck x={79} y={371} value={manual.isSingle} onToggle={() => toggle('isSingle')} />
                        <OVCheck x={79} y={394} value={manual.isDouble} onToggle={() => toggle('isDouble')} />
                        <OVCheck x={79} y={425.5} value={manual.isNew} onToggle={() => toggle('isNew')} />
                        <OVCheck x={79} y={448.5} value={manual.isReprint} onToggle={() => toggle('isReprint')} />

                        {/* 用紙 */}
                        <OVInput x={265} y={134} w={100} name="paper_general_type_t" value={manual.paper_general_type} onChange={onManualChange} />
                        <OVInput x={395} y={134} w={60} name="paper_general_thickness_t" value={manual.paper_general_thickness} onChange={onManualChange} align="center" />
                        <OVInput x={460} y={134} w={80} name="paper_general_needed_t" value={manual.paper_general_needed} onChange={onManualChange} align="right" />

                        <OVInput x={265} y={197} w={100} name="paper_cover_type_t" value={manual.paper_cover_type} onChange={onManualChange} />
                        <OVInput x={395} y={197} w={60} name="paper_cover_thickness_t" value={manual.paper_cover_thickness} onChange={onManualChange} align="center" />
                        <OVInput x={460} y={197} w={80} name="paper_cover_needed_t" value={manual.paper_cover_needed} onChange={onManualChange} align="right" />

                        <OVInput x={265} y={265} w={100} name="paper_body_type_t" value={manual.paper_body_type} onChange={onManualChange} />
                        <OVInput x={395} y={265} w={60} name="paper_body_thickness_t" value={manual.paper_body_thickness} onChange={onManualChange} align="center" />
                        <OVInput x={460} y={265} w={80} name="paper_body_needed_t" value={manual.paper_body_needed} onChange={onManualChange} align="right" />

                        {/* 行テキスト */}
                        <OVInput x={250} y={720} w={420} name="plateVP_line_t" value={linesOverride.plateVP} onChange={(e) => { setLinesDirty(true); setLinesOverride((p) => ({ ...p, plateVP: e.target.value })); }} />
                        <OVInput x={250} y={744} w={420} name="plateGTO_line_t" value={linesOverride.plateGTO} onChange={(e) => { setLinesDirty(true); setLinesOverride((p) => ({ ...p, plateGTO: e.target.value })); }} />
                        <OVInput x={250} y={835} w={420} name="printVP_line_t" value={linesOverride.printVP} onChange={(e) => { setLinesDirty(true); setLinesOverride((p) => ({ ...p, printVP: e.target.value })); }} />
                        <OVInput x={250} y={860} w={420} name="printGTO_line_t" value={linesOverride.printGTO} onChange={(e) => { setLinesDirty(true); setLinesOverride((p) => ({ ...p, printGTO: e.target.value })); }} />
                        <OVInput x={250} y={885} w={420} name="printOD_line_t" value={linesOverride.printOD} onChange={(e) => { setLinesDirty(true); setLinesOverride((p) => ({ ...p, printOD: e.target.value })); }} />

                        {/* 金額（売上伝票と連動） */}
                        <OVInput x={640} y={530} w={110} name="amt_design_t" value={amountOverrideStr.design}
                          onChange={(e) => { setAmountDirty(true); setAmountOverrideStr((p) => ({ ...p, design: e.target.value })); }}
                          align="right"
                        />

                        <OVInput x={640} y={170} w={110} name="amt_paper_general_t" value={amountOverrideStr.paper_general}
                          onChange={(e) => { setAmountDirty(true); setAmountOverrideStr((p) => ({ ...p, paper_general: e.target.value })); }}
                          align="right"
                        />
                        <OVInput x={640} y={300} w={110} name="amt_paper_cover_t" value={amountOverrideStr.paper_cover}
                          onChange={(e) => { setAmountDirty(true); setAmountOverrideStr((p) => ({ ...p, paper_cover: e.target.value })); }}
                          align="right"
                        />
                        <OVInput x={640} y={419} w={110} name="amt_paper_body_t" value={amountOverrideStr.paper_body}
                          onChange={(e) => { setAmountDirty(true); setAmountOverrideStr((p) => ({ ...p, paper_body: e.target.value })); }}
                          align="right"
                        />

                        <OVInput x={640} y={665} w={110} name="amt_plate1_t" value={amountOverrideStr.plate1}
                          onChange={(e) => { setAmountDirty(true); setAmountOverrideStr((p) => ({ ...p, plate1: e.target.value })); }}
                          align="right"
                        />
                        <OVInput x={640} y={690} w={110} name="amt_plate2_t" value={amountOverrideStr.plate2}
                          onChange={(e) => { setAmountDirty(true); setAmountOverrideStr((p) => ({ ...p, plate2: e.target.value })); }}
                          align="right"
                        />

                        <OVInput x={640} y={850} w={110} name="amt_print1_t" value={amountOverrideStr.print1}
                          onChange={(e) => { setAmountDirty(true); setAmountOverrideStr((p) => ({ ...p, print1: e.target.value })); }}
                          align="right"
                        />
                        <OVInput x={640} y={875} w={110} name="amt_print2_t" value={amountOverrideStr.print2}
                          onChange={(e) => { setAmountDirty(true); setAmountOverrideStr((p) => ({ ...p, print2: e.target.value })); }}
                          align="right"
                        />

                        <OVInput x={640} y={975} w={110} name="amt_bind1_t" value={amountOverrideStr.bind1}
                          onChange={(e) => { setAmountDirty(true); setAmountOverrideStr((p) => ({ ...p, bind1: e.target.value })); }}
                          align="right"
                        />
                        <OVInput x={640} y={995} w={110} name="amt_bind2_t" value={amountOverrideStr.bind2}
                          onChange={(e) => { setAmountDirty(true); setAmountOverrideStr((p) => ({ ...p, bind2: e.target.value })); }}
                          align="right"
                        />

                        <OVInput x={640} y={1060} w={110} name="amt_ship1_t" value={amountOverrideStr.ship1}
                          onChange={(e) => { setAmountDirty(true); setAmountOverrideStr((p) => ({ ...p, ship1: e.target.value })); }}
                          align="right"
                        />
                        <OVInput x={640} y={1080} w={110} name="amt_ship2_t" value={amountOverrideStr.ship2}
                          onChange={(e) => { setAmountDirty(true); setAmountOverrideStr((p) => ({ ...p, ship2: e.target.value })); }}
                          align="right"
                        />

                        {/* 下部 合計（同じ state を共有） */}
                        <OVInput x={150} y={1117} w={200} name="grand_unit_t" value={grandText.unit} onChange={onGrandChange('unit')} align="center" />
                        <OVInput x={520} y={1117} w={200} name="grand_total_t" value={grandText.total} onChange={onGrandChange('total')} align="center" />
                        <OVInput x={520} y={1151} w={200} name="grand_tax_t" value={grandText.tax} onChange={onGrandChange('tax')} align="center" />
                        <OVInput x={170} y={1151} w={160} name="grand_total2_t" value={grandText.total2} onChange={onGrandChange('total2')} align="center" />
                      </OverlayImage>
                    </div>
                  </Box>
                </Box>

                {/* 明細の簡易確認 */}
                <Divider sx={{ my: 2 }} />

                <Typography fontWeight={900}>見積明細（確認用）</Typography>
                {detailList.length === 0 ? (
                  <Typography sx={{ color: 'text.secondary' }}>
                    明細がありません（見積の明細登録を確認してください）
                  </Typography>
                ) : (
                  <Paper variant="outlined" sx={{ p: 1, overflow: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%' }} border={1} cellPadding={6}>
                      <thead>
                        <tr style={{ background: '#f7f7f7' }}>
                          <th>詳細</th>
                          <th>サイズ</th>
                          <th>数量</th>
                          <th>P</th>
                          <th>色</th>
                          <th>機械</th>
                          <th>小計（参考）</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailList.map((d) => (
                          <tr key={d.id}>
                            <td>{d.detail_type}</td>
                            <td>{d.size}</td>
                            <td>{d.quantity}</td>
                            <td>{d.pages}</td>
                            <td>{d.colors}</td>
                            <td>{d.machine}</td>
                            <td style={{ textAlign: 'right' }}>
                              {Math.round(Number(d.total_estimated) || 0).toLocaleString('ja-JP')}円
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Paper>
                )}
              </Stack>
            </Paper>
          )}
        </Stack>
      </Box>
    </RequireRole>
  );
}
