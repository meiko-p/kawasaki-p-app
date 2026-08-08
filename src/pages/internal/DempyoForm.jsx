import React, { useCallback, useMemo, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient.jsx';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from '@mui/material';

const BASE_URL = import.meta.env.BASE_URL || '/';
const IMG_TEJUN = `${BASE_URL}forms/tezyun.jpg`;
const IMG_KOUTEI = `${BASE_URL}forms/koutei.jpg`;
const IMG_URIAGE = `${BASE_URL}forms/uriage.jpg`;
const IMG_TOKUSAKI = `${BASE_URL}forms/tokusaki.jpg`;

const BASE_W = 768;
const BASE_H_FORM = 1114;
const BASE_H_SLIP = 1181;

const SERIAL_NEXT_KEY = 'kawasaki.dempyo.slipSerial.next';
const AMOUNT_KEYS = [
  'design',
  'paper_general',
  'paper_cover',
  'paper_body',
  'plate1',
  'plate2',
  'print1',
  'print2',
  'bind1',
  'bind2',
  'ship1',
  'ship2',
];

function pad6(value) {
  const number = Math.max(1, Math.min(999999, Number(value) || 1));
  return String(number).padStart(6, '0');
}

function normalizeNumericString(value) {
  let text = String(value ?? '').trim();
  if (!text) return '';

  text = text.replace(/[０-９]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 0xfee0),
  );
  return text
    .replace(/[，,]/g, '')
    .replace(/[¥￥円冊枚台\s]/g, '')
    .replace(/－/g, '-')
    .replace(/．/g, '.');
}

function toNumberLoose(value) {
  const normalized = normalizeNumericString(value);
  if (!normalized) return 0;
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : 0;
}

function parseAmountLike(value) {
  return Math.round(toNumberLoose(value));
}

function yen(value) {
  return `${Math.round(Number(value || 0)).toLocaleString('ja-JP')}円`;
}

function sanitizeFileName(value) {
  return String(value || '無題').replace(/[\\/:*?"<>|]/g, '');
}

function normalizeSchedule(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** 用紙計算用。A6も従来通り64面付です。 */
function getPaperImpositionSize(size) {
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

/** 製版・印刷台数用。A6だけ2丁製本として32P基準です。 */
function getProductionPagesPerForm(size) {
  return size === 'A6' ? 32 : getPaperImpositionSize(size);
}

function getProductionPageDiv(pages, size) {
  const pageCount = Math.max(0, Math.round(toNumberLoose(pages)));
  return Math.max(1, Math.ceil(pageCount / getProductionPagesPerForm(size)));
}

function getColorSlash(detail) {
  const colors = Math.max(0, toNumberLoose(detail?.colors));
  const colorText = Number.isInteger(colors) ? String(colors) : String(colors || 0);
  return detail?.is_double_sided ? `${colorText}/${colorText}` : `${colorText}/0`;
}

/**
 * 伝票の製版表示。
 * A6 216P・両面1色・VPなら「A1×1/1×7台」です。
 */
function getPlateString(detail) {
  if (!detail || detail.machine === 'オンデマンド') return '';
  const format = detail.machine === 'VP' ? 'A1' : 'A3';
  const pageDiv = getProductionPageDiv(detail.pages, detail.size);
  return `${format}×${getColorSlash(detail)}×${pageDiv}台`;
}

/**
 * 伝票の印刷表示。
 * A6は2丁製本のため数量÷2（端数切上げ）を通し数量として表示します。
 * A6 1000冊・216P・両面1色なら「500×1/1×7台」です。
 */
function getPrintString(detail) {
  if (!detail) return '';

  const quantity = Math.max(0, Math.round(toNumberLoose(detail.quantity)));
  const pages = Math.max(0, Math.round(toNumberLoose(detail.pages)));
  const color = getColorSlash(detail);

  if (detail.machine === 'オンデマンド') {
    const baseCount = Math.ceil(
      (quantity * pages) / getPaperImpositionSize(detail.size),
    );
    return `${baseCount}×${color}`;
  }

  const pageDiv = getProductionPageDiv(pages, detail.size);

  if (detail.size === 'A6') {
    const twoUpRunQuantity = Math.ceil(quantity / 2);
    return `${twoUpRunQuantity}×${color}×${pageDiv}台`;
  }

  const baseCount = Math.ceil(
    (quantity * pages) / getPaperImpositionSize(detail.size),
  );
  return pageDiv === 1
    ? `${baseCount}×${color}`
    : `${quantity}×${color}×${pageDiv}台`;
}

function valueFrom(detail, ...keys) {
  for (const key of keys) {
    const value = detail?.[key];
    if (value !== null && value !== undefined && value !== '') {
      return Number(value) || 0;
    }
  }
  return 0;
}

function blankSchedule() {
  return Array.from({ length: 10 }, () => ({ date: '', text: '' }));
}

function createEmptyManual() {
  return {
    estimateIdText: '',
    clientName: '川崎重工業株式会社',
    productName: '',
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

    paper_general_type: '',
    paper_general_thickness: '',
    paper_general_needed: '',
    paper_cover_type: '',
    paper_cover_thickness: '',
    paper_cover_needed: '',
    paper_body_type: '',
    paper_body_thickness: '',
    paper_body_needed: '',

    schedule: blankSchedule(),
    designMemo: '',
    outsideMemo: '',
    outsideMemo2: '',
    outsideMemo3: '',
    outsideMemo4: '',
    bookMemo: '',
    bookMemo2: '',
    bookMemo3: '',

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

function initAmountOverride() {
  return AMOUNT_KEYS.reduce((output, key) => {
    output[key] = null;
    return output;
  }, {});
}

const OverlayImage = React.forwardRef(function OverlayImage(
  { src, width = BASE_W, height, children, style },
  ref,
) {
  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        width,
        height,
        flex: '0 0 auto',
        backgroundImage: `url(${src})`,
        backgroundSize: '100% 100%',
        backgroundPosition: 'top left',
        backgroundRepeat: 'no-repeat',
        backgroundColor: '#fff',
        border: '1px solid #777',
        overflow: 'hidden',
        ...style,
      }}
    >
      {children}
    </div>
  );
});

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
        padding: '0 2px',
        boxSizing: 'border-box',
        border: 'none',
        outline: 'none',
        background: 'transparent',
        color,
        fontSize,
        textAlign: align,
        fontFamily: 'Arial, "Yu Gothic", sans-serif',
      }}
    />
  );
}

function OVCheck({ x, y, value, onToggle, fontSize = 18, color = 'red' }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title="クリックで切替"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        padding: 0,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        userSelect: 'none',
        color,
        fontSize,
        lineHeight: `${fontSize}px`,
      }}
    >
      {value ? '☑' : '☐'}
    </button>
  );
}

export default function DempyoForm() {
  const [estimates, setEstimates] = useState([]);
  const [selectedEstimateId, setSelectedEstimateId] = useState('');
  const [selectedEstimate, setSelectedEstimate] = useState(null);
  const [detailList, setDetailList] = useState([]);
  const [manual, setManual] = useState(createEmptyManual);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [receiptInfo, setReceiptInfo] = useState(null);

  const [serialNo, setSerialNo] = useState(() => {
    const next = Number(localStorage.getItem(SERIAL_NEXT_KEY) || '1');
    return pad6(next);
  });

  const [amountOverrideStr, setAmountOverrideStr] = useState(initAmountOverride);
  const [linesOverride, setLinesOverride] = useState({
    plateVP: null,
    plateGTO: null,
    printVP: null,
    printGTO: null,
    printOD: null,
  });
  const [grandText, setGrandText] = useState({
    unit: '',
    total: '',
    tax: '',
    total2: '',
  });
  const [grandDirty, setGrandDirty] = useState({
    unit: false,
    total: false,
    tax: false,
    total2: false,
  });

  const tezyunRef = useRef(null);
  const kouteiRef = useRef(null);
  const uriageRef = useRef(null);
  const ledgerRef = useRef(null);

  const fetchEstimates = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const { data, error: fetchError } = await supabase
        .from('estimates')
        .select(
          `
            id,
            title,
            created_at,
            client_id,
            product_id,
            delivery_factory,
            kawasaki_order_no,
            delivery_schedule,
            client:clients (id, name),
            product:products!estimates_product_id_fkey (id, product_code, name, product_type)
          `,
        )
        .order('created_at', { ascending: false })
        .limit(500);

      if (fetchError) throw fetchError;
      setEstimates(data || []);
    } catch (fetchError) {
      // eslint-disable-next-line no-console
      console.error(fetchError);
      setError(fetchError?.message || '見積一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchEstimates();
  }, [fetchEstimates]);

  const fetchReceiptInfo = useCallback(async (estimateId) => {
    const { data, error: receiptError } = await supabase
      .from('dempyos')
      .select('*')
      .eq('estimate_id', estimateId)
      .maybeSingle();

    if (receiptError) {
      // eslint-disable-next-line no-console
      console.error(receiptError);
      return null;
    }

    setReceiptInfo(data || null);
    return data || null;
  }, []);

  const buildManualFromData = useCallback((estimate, details) => {
    const d0 = details[0] || {};
    const cover = details.find((detail) => detail.detail_type === '表紙') || null;
    const body = details.find((detail) => detail.detail_type === '本文') || null;
    const general =
      details.find(
        (detail) =>
          detail.detail_type === '指定無し' || detail.detail_type === '表紙＋本文',
      ) || null;

    const scheduleSource = normalizeSchedule(estimate?.delivery_schedule);
    const schedule = blankSchedule();
    scheduleSource.slice(0, 10).forEach((row, index) => {
      schedule[index] = {
        date: String(row?.date || '').replace(/^\d{4}-/, '').replace('-', '/'),
        text:
          toNumberLoose(row?.qty ?? row?.quantity) > 0
            ? `納品 ${Math.round(toNumberLoose(row?.qty ?? row?.quantity)).toLocaleString('ja-JP')}冊`
            : '納品',
      };
    });

    const bindingMethods = [
      ...new Set(
        details
          .map((detail) => String(detail.binding_method || '').trim())
          .filter(Boolean),
      ),
    ];

    const productCode = estimate?.product?.product_code || estimate?.title || '';
    const productName = estimate?.product?.name || '';
    const clientName = estimate?.client?.name || '川崎重工業株式会社';
    const firstDeliveryDate = scheduleSource.find((row) => row?.date)?.date || '';

    return {
      ...createEmptyManual(),
      estimateIdText: estimate?.id || '',
      clientName,
      productName: productName ? `${productCode} ${productName}` : productCode,
      dueDate: firstDeliveryDate ? String(firstDeliveryDate).replaceAll('-', '/') : '',
      size: d0.size || '',
      quantity: d0.quantity !== null && d0.quantity !== undefined ? String(d0.quantity) : '',
      pages: d0.pages !== null && d0.pages !== undefined ? String(d0.pages) : '',
      colorCount: d0.colors !== null && d0.colors !== undefined ? String(d0.colors) : '',
      detailType: d0.detail_type || '',
      isSingle: d0.is_double_sided === false,
      isDouble: d0.is_double_sided !== false,
      isNew: true,
      isReprint: false,

      paper_general_type: general?.paper_type || '',
      paper_general_thickness: general?.paper_thickness ?? '',
      paper_general_needed: general?.needed_paper ?? '',
      paper_cover_type: cover?.paper_type || '',
      paper_cover_thickness: cover?.paper_thickness ?? '',
      paper_cover_needed: cover?.needed_paper ?? '',
      paper_body_type: body?.paper_type || '',
      paper_body_thickness: body?.paper_thickness ?? '',
      paper_body_needed: body?.needed_paper ?? '',

      schedule,
      designMemo: [
        estimate?.delivery_factory ? `納品工場 ${estimate.delivery_factory}` : '',
        estimate?.kawasaki_order_no ? `注文番号 ${estimate.kawasaki_order_no}` : '',
      ]
        .filter(Boolean)
        .join(' / '),
      bookMemo: bindingMethods[0] || '',
      bookMemo2: bindingMethods[1] || '',
      bookMemo3: bindingMethods[2] || '',

      designInhouse: details.some((detail) => detail.design_type === 'inhouse'),
      designOutsource: details.some((detail) => detail.design_type === 'outsourced'),
      printInhouse: details.some((detail) => detail.print_type === 'inhouse'),
      printOutsource: details.some((detail) => detail.print_type === 'outsourced'),
      bindInhouse: true,
      bindOutsource: false,
      mVP: details.some((detail) => detail.machine === 'VP'),
      mGTO: details.some((detail) => detail.machine === 'GTO'),
      mOD: details.some((detail) => detail.machine === 'オンデマンド'),
    };
  }, []);

  const loadEstimate = useCallback(
    async (estimateId) => {
      setSelectedEstimateId(estimateId);
      setError('');
      setSuccess('');
      setReceiptInfo(null);

      if (!estimateId) {
        setSelectedEstimate(null);
        setDetailList([]);
        setManual(createEmptyManual());
        return;
      }

      setLoading(true);
      try {
        const estimate = estimates.find((row) => row.id === estimateId);
        if (!estimate) throw new Error('選択した見積が一覧にありません');

        const { data: details, error: detailError } = await supabase
          .from('estimate_details')
          .select('*')
          .eq('estimate_id', estimateId)
          .order('created_at', { ascending: true });

        if (detailError) throw detailError;

        const list = details || [];
        setSelectedEstimate(estimate);
        setDetailList(list);

        const derivedManual = buildManualFromData(estimate, list);
        const storageKey = `kawasaki.dempyo.manual.${estimateId}`;
        const stored = localStorage.getItem(storageKey);
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            setManual({ ...derivedManual, ...parsed });
          } catch {
            setManual(derivedManual);
          }
        } else {
          setManual(derivedManual);
        }

        setAmountOverrideStr(initAmountOverride());
        setLinesOverride({
          plateVP: null,
          plateGTO: null,
          printVP: null,
          printGTO: null,
          printOD: null,
        });
        setGrandText({ unit: '', total: '', tax: '', total2: '' });
        setGrandDirty({ unit: false, total: false, tax: false, total2: false });
        await fetchReceiptInfo(estimateId);
      } catch (loadError) {
        // eslint-disable-next-line no-console
        console.error(loadError);
        setError(loadError?.message || '見積明細の取得に失敗しました');
      } finally {
        setLoading(false);
      }
    },
    [buildManualFromData, estimates, fetchReceiptInfo],
  );

  React.useEffect(() => {
    if (!selectedEstimateId) return;
    localStorage.setItem(
      `kawasaki.dempyo.manual.${selectedEstimateId}`,
      JSON.stringify(manual),
    );
  }, [manual, selectedEstimateId]);

  const sums = useMemo(() => {
    const sum = (rows, ...keys) =>
      rows.reduce((total, detail) => total + valueFrom(detail, ...keys), 0);

    const cover = detailList.filter((detail) => detail.detail_type === '表紙');
    const body = detailList.filter((detail) => detail.detail_type === '本文');
    const general = detailList.filter(
      (detail) =>
        detail.detail_type === '指定無し' || detail.detail_type === '表紙＋本文',
    );

    return {
      paper_general: sum(general, 'paper_cost'),
      paper_cover: sum(cover, 'paper_cost'),
      paper_body: sum(body, 'paper_cost'),

      plate_general: sum(general, 'plate_cost'),
      plate_cover: sum(cover, 'plate_cost'),
      plate_body: sum(body, 'plate_cost'),

      print_general: sum(general, 'print_cost', 'actual_print_cost'),
      print_cover: sum(cover, 'print_cost', 'actual_print_cost'),
      print_body: sum(body, 'print_cost', 'actual_print_cost'),

      bind_general: sum(general, 'binding_cost'),
      bind_cover: sum(cover, 'binding_cost'),
      bind_body: sum(body, 'binding_cost'),

      ship_general: sum(general, 'shipping_cost'),
      ship_cover: sum(cover, 'shipping_cost'),
      ship_body: sum(body, 'shipping_cost'),

      design_total: sum(detailList, 'design_cost', 'total_design_cost'),
    };
  }, [detailList]);

  const rightCol = useMemo(
    () => ({
      design: sums.design_total,
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
    }),
    [sums],
  );

  React.useEffect(() => {
    setAmountOverrideStr((previous) => {
      const next = { ...previous };
      for (const key of AMOUNT_KEYS) {
        if (previous[key] === null) next[key] = yen(rightCol[key] || 0);
      }
      return next;
    });
  }, [rightCol]);

  const usedAmount = useMemo(() => {
    const output = {};
    for (const key of AMOUNT_KEYS) {
      output[key] = parseAmountLike(amountOverrideStr[key]);
    }
    return output;
  }, [amountOverrideStr]);

  const rightSum = useMemo(
    () => AMOUNT_KEYS.reduce((total, key) => total + (usedAmount[key] || 0), 0),
    [usedAmount],
  );

  const quantityForUnit = useMemo(
    () => Math.max(0, parseAmountLike(manual.quantity)),
    [manual.quantity],
  );

  const autoGrand = useMemo(() => {
    const total = rightSum;
    const unit = quantityForUnit > 0 ? Math.round(total / quantityForUnit) : 0;
    const tax = Math.floor(total * 0.1);
    return { total, unit, tax };
  }, [quantityForUnit, rightSum]);

  React.useEffect(() => {
    setGrandText((previous) => {
      const next = { ...previous };
      if (!grandDirty.unit) next.unit = yen(autoGrand.unit);
      if (!grandDirty.total) next.total = yen(autoGrand.total);
      if (!grandDirty.tax) next.tax = yen(autoGrand.tax);
      if (!grandDirty.total2) next.total2 = yen(autoGrand.total);
      return next;
    });
  }, [autoGrand, grandDirty]);

  const plateStrings = useMemo(
    () => ({
      vp: detailList
        .filter((detail) => detail.machine === 'VP')
        .map(getPlateString)
        .filter(Boolean),
      gto: detailList
        .filter((detail) => detail.machine === 'GTO')
        .map(getPlateString)
        .filter(Boolean),
    }),
    [detailList],
  );

  const printStrings = useMemo(
    () => ({
      vp: detailList
        .filter((detail) => detail.machine === 'VP')
        .map(getPrintString)
        .filter(Boolean),
      gto: detailList
        .filter((detail) => detail.machine === 'GTO')
        .map(getPrintString)
        .filter(Boolean),
      od: detailList
        .filter((detail) => detail.machine === 'オンデマンド')
        .map(getPrintString)
        .filter(Boolean),
    }),
    [detailList],
  );

  React.useEffect(() => {
    setLinesOverride((previous) => ({
      plateVP: previous.plateVP ?? `VP・・・・・・${plateStrings.vp.join('、')}`,
      plateGTO: previous.plateGTO ?? `GTO・・・・・${plateStrings.gto.join('、')}`,
      printVP: previous.printVP ?? `VP・・・・・・${printStrings.vp.join('、')}`,
      printGTO: previous.printGTO ?? `GTO・・・・・${printStrings.gto.join('、')}`,
      printOD: previous.printOD ?? `オンデマンド・・${printStrings.od.join('、')}`,
    }));
  }, [plateStrings, printStrings]);

  const onManualChange = (event) => {
    const { name, value } = event.target;
    setManual((previous) => ({ ...previous, [name]: value }));
  };

  const toggle = (key) => {
    setManual((previous) => ({ ...previous, [key]: !previous[key] }));
  };

  const onGrandChange = (key) => (event) => {
    const value = event.target.value;
    setGrandText((previous) => {
      const next = { ...previous, [key]: value };
      if (key === 'total') {
        if (!grandDirty.tax) next.tax = yen(Math.floor(parseAmountLike(value) * 0.1));
        if (!grandDirty.total2) next.total2 = value;
      }
      return next;
    });
    setGrandDirty((previous) => ({ ...previous, [key]: true }));
  };

  const updateSchedule = (index, field, value) => {
    setManual((previous) => {
      const schedule = [...previous.schedule];
      schedule[index] = { ...schedule[index], [field]: value };
      return { ...previous, schedule };
    });
  };

  const renderSchedule = (type) => {
    if (type === 'tezyun') {
      return manual.schedule.map((row, index) => (
        <React.Fragment key={`tezyun-${index}`}>
          <OVInput
            x={630}
            y={150 + index * 55}
            w={38}
            value={row.date}
            onChange={(event) => updateSchedule(index, 'date', event.target.value)}
            fontSize={10}
          />
          <OVInput
            x={672}
            y={150 + index * 55}
            w={82}
            value={row.text}
            onChange={(event) => updateSchedule(index, 'text', event.target.value)}
            fontSize={10}
          />
        </React.Fragment>
      ));
    }

    if (type === 'koutei') {
      return manual.schedule.map((row, index) => (
        <React.Fragment key={`koutei-${index}`}>
          <OVInput
            x={635}
            y={153 + index * 105}
            w={40}
            value={row.date}
            onChange={(event) => updateSchedule(index, 'date', event.target.value)}
            fontSize={10}
          />
          <OVInput
            x={680}
            y={153 + index * 105}
            w={74}
            value={row.text}
            onChange={(event) => updateSchedule(index, 'text', event.target.value)}
            fontSize={10}
          />
        </React.Fragment>
      ));
    }

    return null;
  };

  const renderAmountFields = (type) => {
    if (type !== 'uriage' && type !== 'tokusaki') return null;

    const coordinates =
      type === 'uriage'
        ? {
            design: 530,
            paper_general: 180,
            paper_cover: 300,
            paper_body: 425,
            plate1: 690,
            plate2: 720,
            print1: 850,
            print2: 885,
            bind1: 973,
            bind2: 995,
            ship1: 1058,
            ship2: 1079,
          }
        : {
            design: 530,
            paper_general: 170,
            paper_cover: 300,
            paper_body: 419,
            plate1: 665,
            plate2: 690,
            print1: 850,
            print2: 875,
            bind1: 975,
            bind2: 995,
            ship1: 1060,
            ship2: 1080,
          };

    return (
      <>
        {AMOUNT_KEYS.map((key) => (
          <OVInput
            key={`${type}-${key}`}
            x={640}
            y={coordinates[key]}
            w={110}
            value={amountOverrideStr[key] ?? ''}
            onChange={(event) =>
              setAmountOverrideStr((previous) => ({
                ...previous,
                [key]: event.target.value,
              }))
            }
            align="right"
          />
        ))}

        <OVInput
          x={150}
          y={1117}
          w={200}
          value={grandText.unit}
          onChange={onGrandChange('unit')}
          align="center"
        />
        <OVInput
          x={520}
          y={1117}
          w={200}
          value={grandText.total}
          onChange={onGrandChange('total')}
          align="center"
        />
        <OVInput
          x={520}
          y={1151}
          w={200}
          value={grandText.tax}
          onChange={onGrandChange('tax')}
          align="center"
        />
        <OVInput
          x={170}
          y={1151}
          w={160}
          value={grandText.total2}
          onChange={onGrandChange('total2')}
          align="center"
        />
      </>
    );
  };

  const renderSlip = (type, sheetRef = null) => {
    const isLong = type === 'uriage' || type === 'tokusaki';
    const src =
      type === 'tezyun'
        ? IMG_TEJUN
        : type === 'koutei'
          ? IMG_KOUTEI
          : type === 'uriage'
            ? IMG_URIAGE
            : IMG_TOKUSAKI;
    const height = isLong ? BASE_H_SLIP : BASE_H_FORM;

    const basicY = {
      dueDate: isLong ? 115 : 118,
      size: 169,
      quantity: 220,
      pages: 272,
      color: 328,
      single: isLong ? 371 : 372,
      double: isLong ? 394 : 395,
      isNew: isLong ? 425.5 : 426.5,
      reprint: isLong ? 448.5 : 449.5,
      designIn: isLong ? 518 : 519,
      designOut: isLong ? 541 : 542,
      designMemo: 534,
      printIn: isLong ? 619 : 621,
      printOut: isLong ? 641.8 : 643.8,
      machine: isLong ? 631 : 632,
      outside1: isLong ? 710 : 712,
      outside2: isLong ? 733 : 735,
      outside3: isLong ? 757 : 760,
      plateVP: type === 'tokusaki' ? 720 : 725,
      plateGTO: 744,
      printVP: 835,
      printGTO: 860,
      printOD: 885,
      bindIn: isLong ? 981 : 983,
      bindOut: isLong ? 1003.5 : 1006,
      book1: isLong ? 1009 : 1010,
      book2: isLong ? 1033 : 1035,
      book3: isLong ? 1056 : 1065,
      outside4: isLong ? 1053.5 : 1056,
    };

    const headerEstimateX = type === 'tezyun' || type === 'koutei' ? 15 : 12;
    const serialX = type === 'tokusaki' ? 60 : 205;
    const serialY = type === 'tokusaki' ? 15 : 31;
    const serialW = type === 'tokusaki' ? 110 : 90;

    return (
      <OverlayImage ref={sheetRef} src={src} width={BASE_W} height={height}>
        <OVInput
          x={headerEstimateX}
          y={31}
          w={185}
          value={manual.estimateIdText}
          onChange={(event) =>
            setManual((previous) => ({
              ...previous,
              estimateIdText: event.target.value,
            }))
          }
          fontSize={9}
        />
        <OVInput
          x={serialX}
          y={serialY}
          w={serialW}
          value={serialNo}
          onChange={(event) => setSerialNo(event.target.value)}
          fontSize={type === 'tokusaki' ? 15 : 10}
          align="center"
        />
        <OVInput
          x={340}
          y={15}
          w={280}
          value={manual.clientName}
          onChange={(event) =>
            setManual((previous) => ({ ...previous, clientName: event.target.value }))
          }
          fontSize={17}
        />
        <OVInput
          x={340}
          y={65}
          w={280}
          value={manual.productName}
          onChange={(event) =>
            setManual((previous) => ({ ...previous, productName: event.target.value }))
          }
          fontSize={16}
        />

        <OVInput x={90} y={basicY.dueDate} w={140} name="dueDate" value={manual.dueDate} onChange={onManualChange} fontSize={20} />
        <OVInput x={100} y={basicY.size} w={160} name="size" value={manual.size} onChange={onManualChange} fontSize={24} />
        <OVInput x={100} y={basicY.quantity} w={160} name="quantity" value={manual.quantity} onChange={onManualChange} fontSize={20} />
        <OVInput x={120} y={basicY.pages} w={160} name="pages" value={manual.pages} onChange={onManualChange} fontSize={20} />
        <OVInput x={100} y={basicY.color} w={160} name="colorCount" value={manual.colorCount} onChange={onManualChange} fontSize={24} />

        <OVCheck x={79} y={basicY.single} value={manual.isSingle} onToggle={() => toggle('isSingle')} />
        <OVCheck x={79} y={basicY.double} value={manual.isDouble} onToggle={() => toggle('isDouble')} />
        <OVCheck x={79} y={basicY.isNew} value={manual.isNew} onToggle={() => toggle('isNew')} />
        <OVCheck x={79} y={basicY.reprint} value={manual.isReprint} onToggle={() => toggle('isReprint')} />

        <OVInput x={265} y={134} w={110} name="paper_general_type" value={manual.paper_general_type} onChange={onManualChange} />
        <OVInput x={395} y={134} w={60} name="paper_general_thickness" value={manual.paper_general_thickness} onChange={onManualChange} align="center" />
        <OVInput x={460} y={134} w={80} name="paper_general_needed" value={manual.paper_general_needed} onChange={onManualChange} align="right" />

        <OVInput x={265} y={197} w={110} name="paper_cover_type" value={manual.paper_cover_type} onChange={onManualChange} />
        <OVInput x={395} y={197} w={60} name="paper_cover_thickness" value={manual.paper_cover_thickness} onChange={onManualChange} align="center" />
        <OVInput x={460} y={197} w={80} name="paper_cover_needed" value={manual.paper_cover_needed} onChange={onManualChange} align="right" />

        <OVInput x={265} y={265} w={110} name="paper_body_type" value={manual.paper_body_type} onChange={onManualChange} />
        <OVInput x={395} y={265} w={60} name="paper_body_thickness" value={manual.paper_body_thickness} onChange={onManualChange} align="center" />
        <OVInput x={460} y={265} w={80} name="paper_body_needed" value={manual.paper_body_needed} onChange={onManualChange} align="right" />

        <OVCheck x={79} y={basicY.designIn} value={manual.designInhouse} onToggle={() => toggle('designInhouse')} />
        <OVCheck x={79} y={basicY.designOut} value={manual.designOutsource} onToggle={() => toggle('designOutsource')} />
        <OVInput x={225} y={basicY.designMemo} w={405} h={30} name="designMemo" value={manual.designMemo} onChange={onManualChange} fontSize={15} />

        <OVCheck x={79} y={basicY.printIn} value={manual.printInhouse} onToggle={() => toggle('printInhouse')} />
        <OVCheck x={79} y={basicY.printOut} value={manual.printOutsource} onToggle={() => toggle('printOutsource')} />
        <OVCheck x={312} y={basicY.machine} value={manual.mVP} onToggle={() => toggle('mVP')} />
        <OVCheck x={359} y={basicY.machine} value={manual.mGTO} onToggle={() => toggle('mGTO')} />
        <OVCheck x={417} y={basicY.machine} value={manual.mOD} onToggle={() => toggle('mOD')} />

        <OVInput x={30} y={basicY.outside1} w={170} h={24} name="outsideMemo" value={manual.outsideMemo} onChange={onManualChange} />
        <OVInput x={30} y={basicY.outside2} w={170} h={24} name="outsideMemo2" value={manual.outsideMemo2} onChange={onManualChange} />
        <OVInput x={30} y={basicY.outside3} w={170} h={24} name="outsideMemo3" value={manual.outsideMemo3} onChange={onManualChange} />

        <OVInput x={250} y={basicY.plateVP} w={420} value={linesOverride.plateVP ?? ''} onChange={(event) => setLinesOverride((previous) => ({ ...previous, plateVP: event.target.value }))} />
        <OVInput x={250} y={basicY.plateGTO} w={420} value={linesOverride.plateGTO ?? ''} onChange={(event) => setLinesOverride((previous) => ({ ...previous, plateGTO: event.target.value }))} />
        <OVInput x={250} y={basicY.printVP} w={420} value={linesOverride.printVP ?? ''} onChange={(event) => setLinesOverride((previous) => ({ ...previous, printVP: event.target.value }))} />
        <OVInput x={250} y={basicY.printGTO} w={420} value={linesOverride.printGTO ?? ''} onChange={(event) => setLinesOverride((previous) => ({ ...previous, printGTO: event.target.value }))} />
        <OVInput x={250} y={basicY.printOD} w={420} value={linesOverride.printOD ?? ''} onChange={(event) => setLinesOverride((previous) => ({ ...previous, printOD: event.target.value }))} />

        <OVCheck x={79} y={basicY.bindIn} value={manual.bindInhouse} onToggle={() => toggle('bindInhouse')} />
        <OVCheck x={79} y={basicY.bindOut} value={manual.bindOutsource} onToggle={() => toggle('bindOutsource')} />
        <OVInput x={245} y={basicY.book1} w={360} h={24} name="bookMemo" value={manual.bookMemo} onChange={onManualChange} />
        <OVInput x={245} y={basicY.book2} w={360} h={24} name="bookMemo2" value={manual.bookMemo2} onChange={onManualChange} />
        <OVInput x={245} y={basicY.book3} w={360} h={24} name="bookMemo3" value={manual.bookMemo3} onChange={onManualChange} />
        <OVInput x={30} y={basicY.outside4} w={170} h={24} name="outsideMemo4" value={manual.outsideMemo4} onChange={onManualChange} />

        {renderSchedule(type)}
        {renderAmountFields(type)}
      </OverlayImage>
    );
  };

  const exportNodeToPdf = useCallback(async (node, fileBase, options = {}) => {
    if (!node) throw new Error('PDF対象がありません');
    const { fitOnePage = false } = options;

    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }

    const canvas = await html2canvas(node, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      windowWidth: node.scrollWidth || node.clientWidth,
      windowHeight: node.scrollHeight || node.clientHeight,
      scrollY: 0,
    });

    const imageData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();

    let imageWidth = pdfWidth;
    let imageHeight = (canvas.height * imageWidth) / canvas.width;

    if (fitOnePage) {
      const ratio = Math.min(pdfWidth / canvas.width, pdfHeight / canvas.height);
      imageWidth = canvas.width * ratio;
      imageHeight = canvas.height * ratio;
      const x = (pdfWidth - imageWidth) / 2;
      const y = (pdfHeight - imageHeight) / 2;
      pdf.addImage(imageData, 'PNG', x, y, imageWidth, imageHeight);
    } else {
      let position = 0;
      let remaining = imageHeight;
      pdf.addImage(imageData, 'PNG', 0, position, imageWidth, imageHeight);
      remaining -= pdfHeight;

      while (remaining > 0) {
        position -= pdfHeight;
        pdf.addPage();
        pdf.addImage(imageData, 'PNG', 0, position, imageWidth, imageHeight);
        remaining -= pdfHeight;
      }
    }

    pdf.save(`${fileBase}_${new Date().toISOString().slice(0, 10)}.pdf`);
  }, []);

  const exportNodesToPdf = useCallback(async (nodes, fileBase) => {
    const targets = (nodes || []).filter(Boolean);
    if (targets.length === 0) throw new Error('PDF対象がありません');

    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }

    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();

    for (let index = 0; index < targets.length; index += 1) {
      const node = targets[index];
      const canvas = await html2canvas(node, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        windowWidth: node.scrollWidth || node.clientWidth,
        windowHeight: node.scrollHeight || node.clientHeight,
        scrollY: 0,
      });

      if (index > 0) pdf.addPage();

      const imageData = canvas.toDataURL('image/png');
      const ratio = Math.min(pdfWidth / canvas.width, pdfHeight / canvas.height);
      const imageWidth = canvas.width * ratio;
      const imageHeight = canvas.height * ratio;
      const x = (pdfWidth - imageWidth) / 2;
      const y = (pdfHeight - imageHeight) / 2;
      pdf.addImage(imageData, 'PNG', x, y, imageWidth, imageHeight);
    }

    pdf.save(`${fileBase}_${new Date().toISOString().slice(0, 10)}.pdf`);
  }, []);

  const bumpSerialAfterPdf = useCallback((usedSerial) => {
    const digits = String(usedSerial || '').replace(/\D/g, '');
    let usedNumber = Number(digits || localStorage.getItem(SERIAL_NEXT_KEY) || '1');
    if (!Number.isFinite(usedNumber) || usedNumber < 1) usedNumber = 1;
    let next = usedNumber + 1;
    if (next > 999999) next = 1;
    localStorage.setItem(SERIAL_NEXT_KEY, String(next));
    setSerialNo(pad6(next));
  }, []);

  const downloadSetOnePdf = async () => {
    setBusy(true);
    setError('');
    try {
      const base = `${manual.estimateIdText}_${sanitizeFileName(manual.productName)}_手順票工程表`;
      await exportNodesToPdf([tezyunRef.current, kouteiRef.current], base);
      bumpSerialAfterPdf(serialNo);
      setSuccess('手順票・工程表PDFを保存しました');
    } catch (pdfError) {
      // eslint-disable-next-line no-console
      console.error(pdfError);
      setError(pdfError?.message || 'PDF保存に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const downloadLedgerPdf = async () => {
    setBusy(true);
    setError('');
    try {
      const base = `${manual.estimateIdText}_${sanitizeFileName(manual.productName)}_得意先元帳`;
      await exportNodeToPdf(ledgerRef.current, base, { fitOnePage: true });
      bumpSerialAfterPdf(serialNo);
      setSuccess('得意先元帳PDFを保存しました');
    } catch (pdfError) {
      // eslint-disable-next-line no-console
      console.error(pdfError);
      setError(pdfError?.message || 'PDF保存に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const downloadSetTwoPdf = async () => {
    setBusy(true);
    setError('');
    try {
      const base = `${manual.estimateIdText}_${sanitizeFileName(manual.productName)}_売上伝票得意先元帳`;
      await exportNodesToPdf([uriageRef.current, ledgerRef.current], base);
      setSuccess('売上伝票・得意先元帳PDFを保存しました');
    } catch (pdfError) {
      // eslint-disable-next-line no-console
      console.error(pdfError);
      setError(pdfError?.message || 'PDF保存に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const confirmReceipt = async () => {
    if (!selectedEstimate?.id || !selectedEstimate?.product_id) {
      setError('見積を選択してください');
      return;
    }

    const quantity = Math.max(0, Math.round(toNumberLoose(manual.quantity)));
    if (quantity <= 0) {
      setError('入庫数量を1冊以上で入力してください');
      return;
    }

    if (receiptInfo?.received_at) {
      setError('この見積はすでに入庫確定済みです');
      return;
    }

    if (
      !window.confirm(
        `品番「${selectedEstimate.product?.product_code || selectedEstimate.title || ''}」を${quantity.toLocaleString('ja-JP')}冊で入庫確定します。よろしいですか？`,
      )
    ) {
      return;
    }

    setBusy(true);
    setError('');
    setSuccess('');

    try {
      const payload = {
        estimate_id: selectedEstimate.id,
        product_id: selectedEstimate.product_id,
        received_qty: quantity,
        received_at: new Date().toISOString(),
      };

      if (receiptInfo?.id) {
        const { error: updateError } = await supabase
          .from('dempyos')
          .update(payload)
          .eq('id', receiptInfo.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase.from('dempyos').insert(payload);
        if (insertError) throw insertError;
      }

      await fetchReceiptInfo(selectedEstimate.id);
      setSuccess('入庫を確定し、在庫INへ反映しました');
    } catch (receiptError) {
      // eslint-disable-next-line no-console
      console.error(receiptError);
      setError(receiptError?.message || '入庫確定に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const a6Details = detailList.filter((detail) => detail.size === 'A6');

  return (
    <Stack spacing={2}>
      <Paper sx={{ p: 2 }}>
        <Stack spacing={1.5}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.5}
            alignItems={{ md: 'center' }}
          >
            <FormControl fullWidth>
              <InputLabel id="dempyo-estimate-label">品番・見積を選択</InputLabel>
              <Select
                labelId="dempyo-estimate-label"
                label="品番・見積を選択"
                value={selectedEstimateId}
                onChange={(event) => loadEstimate(event.target.value)}
              >
                <MenuItem value="">
                  <em>選択してください</em>
                </MenuItem>
                {estimates.map((estimate) => (
                  <MenuItem key={estimate.id} value={estimate.id}>
                    {estimate.product?.product_code || estimate.title || '-'}{' '}
                    {estimate.product?.name || ''}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Button variant="outlined" onClick={fetchEstimates} disabled={loading} sx={{ minWidth: 150 }}>
              一覧再読み込み
            </Button>

            <Button
              variant="contained"
              color="success"
              onClick={confirmReceipt}
              disabled={!selectedEstimate || busy || Boolean(receiptInfo?.received_at)}
              sx={{ minWidth: 180 }}
            >
              {receiptInfo?.received_at ? '入庫確定済' : 'この伝票で入庫確定'}
            </Button>
          </Stack>

          {loading && (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={18} />
              <Typography variant="body2">読み込み中…</Typography>
            </Stack>
          )}

          {selectedEstimate && (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip label={`品番：${selectedEstimate.product?.product_code || selectedEstimate.title || '-'}`} variant="outlined" />
              <Chip label={`明細：${detailList.length}件`} variant="outlined" />
              <Chip label={`伝票番号：${serialNo}`} color="primary" variant="outlined" />
              {receiptInfo?.received_at && (
                <Chip
                  label={`入庫済：${new Date(receiptInfo.received_at).toLocaleString('ja-JP')} / ${Number(receiptInfo.received_qty || 0).toLocaleString('ja-JP')}冊`}
                  color="success"
                />
              )}
            </Stack>
          )}
        </Stack>
      </Paper>

      {error && <Alert severity="error">{error}</Alert>}
      {success && <Alert severity="success">{success}</Alert>}

      {a6Details.length > 0 && (
        <Alert severity="info">
          A6は2丁製本対応です。製版・印刷台数はページ数÷32の切り上げ、印刷通し表示数量は冊数÷2の切り上げで伝票へ反映しています。用紙必要数は従来通り64面付です。
        </Alert>
      )}

      {!selectedEstimate ? (
        <Alert severity="info">上部から品番・見積を選択してください。</Alert>
      ) : (
        <>
          <Paper sx={{ p: 1.5 }}>
            <Typography fontWeight={900} sx={{ mb: 1 }}>
              伝票プレビュー・自由修正
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              手順票を起点に4帳票が同じstateを共有しています。赤文字はすべて直接修正できます。
            </Typography>

            <Box sx={{ overflowX: 'auto' }}>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(2, ${BASE_W}px)`,
                  gap: 2,
                  alignItems: 'start',
                  minWidth: BASE_W * 2 + 16,
                }}
              >
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {renderSlip('tezyun', tezyunRef)}
                  {renderSlip('koutei', kouteiRef)}
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {renderSlip('uriage', uriageRef)}
                  {renderSlip('tokusaki', ledgerRef)}
                </Box>
              </Box>
            </Box>
          </Paper>

          <Paper sx={{ p: 2 }}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button variant="contained" onClick={downloadSetOnePdf} disabled={busy}>
                手順票＋工程表をPDF保存
              </Button>
              <Button variant="contained" onClick={downloadLedgerPdf} disabled={busy}>
                得意先元帳をPDF保存
              </Button>
              <Button variant="outlined" onClick={downloadSetTwoPdf} disabled={busy}>
                売上伝票＋得意先元帳をPDF保存
              </Button>
              <Button
                variant="outlined"
                onClick={() => {
                  localStorage.removeItem(`kawasaki.dempyo.manual.${selectedEstimateId}`);
                  loadEstimate(selectedEstimateId);
                }}
                disabled={busy}
              >
                見積内容から再反映
              </Button>
            </Stack>
          </Paper>

          <Divider />

          <Paper sx={{ p: 2 }}>
            <Typography fontWeight={900} sx={{ mb: 1 }}>
              A6 2丁製本の伝票表示確認
            </Typography>
            {a6Details.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                この見積にはA6明細がありません。
              </Typography>
            ) : (
              <Stack spacing={0.8}>
                {a6Details.map((detail) => (
                  <Box
                    key={detail.id}
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', md: '110px minmax(0,1fr) minmax(0,1fr)' },
                      gap: 1,
                      alignItems: 'center',
                    }}
                  >
                    <Chip size="small" label={detail.detail_type || '明細'} variant="outlined" />
                    <Typography variant="body2">製版：{getPlateString(detail) || '-'}</Typography>
                    <Typography variant="body2">印刷：{getPrintString(detail) || '-'}</Typography>
                  </Box>
                ))}
              </Stack>
            )}
          </Paper>
        </>
      )}
    </Stack>
  );
}
