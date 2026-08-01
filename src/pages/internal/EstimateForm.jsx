import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient.jsx';

import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControl,
  FormControlLabel,
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

const COVER_BINDING_METHOD = 'マットPP加工＆無線綴じ（巻取り）';
const BODY_BINDING_METHOD = '無線綴じ';

const BINDING_PROFIT_OPTIONS = Array.from({ length: 10 }, (_, index) =>
  (1.1 + index * 0.1).toFixed(1),
);

/**
 * 用紙必要数だけは従来通りの面付数を使用します。
 * A6も用紙計算上は64面付のままです。
 */
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

/**
 * 製版・印刷台数の計算に使う1台あたりページ数。
 * A6は2丁製本のため32P基準、それ以外は従来通りです。
 */
function getProductionPagesPerForm(size) {
  if (size === 'A6') return 32;
  return getPaperImpositionSize(size);
}

function getProductionPageDiv(pages, size) {
  const pageCount = Math.max(0, Math.round(toNumberLoose(pages)));
  return Math.max(1, Math.ceil(pageCount / getProductionPagesPerForm(size)));
}

function normalizeNumericString(value) {
  let text = String(value ?? '').trim();
  if (!text) return '';

  text = text.replace(/[０-９]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 0xfee0),
  );
  text = text
    .replace(/／/g, '/')
    .replace(/－/g, '-')
    .replace(/．/g, '.')
    .replace(/[，,]/g, '')
    .replace(/[¥￥\s]/g, '');

  return text;
}

function toNumberLoose(value) {
  const text = normalizeNumericString(value);
  if (!text) return 0;

  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return 0;

  const number = Number(match[0]);
  return Number.isFinite(number) ? number : 0;
}

function toRateLoose(value, fallback = 1) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;

  const number = toNumberLoose(raw);
  if (!Number.isFinite(number)) return fallback;
  return raw.includes('%') || raw.includes('％') ? number / 100 : number;
}

function clampBindingProfitRate(value) {
  const rate = toRateLoose(value, 1.1);
  return Math.min(2, Math.max(1.1, rate));
}

function nonNegativeInteger(value) {
  return Math.max(0, Math.round(toNumberLoose(value)));
}

function yen(value) {
  return `${Math.round(Number(value || 0)).toLocaleString('ja-JP')}円`;
}

function formatDateJa(value) {
  if (!value) return '-';
  const [year, month, day] = String(value).split('-');
  return year && month && day ? `${year}/${month}/${day}` : String(value);
}

function createInitialDetail(initialQuantity = 0) {
  return {
    detail_type: '表紙＋本文',
    size: 'A5',
    quantity: initialQuantity > 0 ? String(initialQuantity) : '1000',
    pages: '2',
    colors: '4',
    is_double_sided: true,
    binding_method: '',
    binding_profit_rate: '1.1',
    binding_auto_calculated: false,
    shipping_auto_calculated: false,

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
}

function getBindingTarget(detail) {
  const eligibleSize = detail.size === 'A5' || detail.size === 'A6';
  if (!eligibleSize) return '';

  if (
    detail.detail_type === '表紙' &&
    String(detail.binding_method || '').trim() === COVER_BINDING_METHOD
  ) {
    return 'COVER';
  }

  if (
    detail.detail_type === '本文' &&
    String(detail.binding_method || '').trim() === BODY_BINDING_METHOD
  ) {
    return 'BODY';
  }

  return '';
}

function getRecommendedBindingMethods(detail) {
  if (!(detail.size === 'A5' || detail.size === 'A6')) return [];
  if (detail.detail_type === '表紙') return [COVER_BINDING_METHOD];
  if (detail.detail_type === '本文') return [BODY_BINDING_METHOD];
  return [];
}

function coverBindingUnitPrice(size, quantity) {
  const qty = nonNegativeInteger(quantity);

  if (size === 'A5') {
    if (qty <= 2000) return 19;
    if (qty <= 5000) return 18;
    if (qty <= 10000) return 16;
    return 15;
  }

  if (size === 'A6') {
    if (qty <= 5000) return 16;
    if (qty <= 10000) return 15;
    return 14;
  }

  return 0;
}

function bodyBindingUnitPrice(size, quantity) {
  const qty = nonNegativeInteger(quantity);

  if (size === 'A5') {
    if (qty <= 2000) return 2.5;
    if (qty <= 5000) return 2.0;
    if (qty <= 10000) return 1.6;
    return 1.4;
  }

  if (size === 'A6') {
    if (qty <= 500) return 3.5;
    if (qty <= 2000) return 2.5;
    if (qty <= 5000) return 2.0;
    if (qty <= 10000) return 1.6;
    return 1.4;
  }

  return 0;
}

function coverShippingPrice(quantity) {
  const qty = nonNegativeInteger(quantity);
  if (qty <= 0) return 0;
  if (qty <= 1000) return 4400;
  if (qty <= 5000) return 8800;
  if (qty <= 10000) return 13200;
  return 17000;
}

function calculateAutoFinishing(detail) {
  const target = getBindingTarget(detail);
  const quantity = nonNegativeInteger(detail.quantity);
  const pages = nonNegativeInteger(detail.pages);
  const profitRate = clampBindingProfitRate(detail.binding_profit_rate);

  if (target === 'COVER') {
    const unitPrice = coverBindingUnitPrice(detail.size, quantity);
    const bindingCost = Math.round(quantity * unitPrice * profitRate);

    return {
      target,
      eligible: true,
      unitPrice,
      pageUnits: 1,
      profitRate,
      bindingCost,
      shippingCost: coverShippingPrice(quantity),
      formula: `${quantity.toLocaleString('ja-JP')}冊 × ${unitPrice}円 × 利益${profitRate.toFixed(1)}`,
    };
  }

  if (target === 'BODY') {
    const pageUnits = Math.max(1, Math.ceil(pages / 16));
    const unitPrice = bodyBindingUnitPrice(detail.size, quantity);
    const bindingCost = Math.round(pageUnits * unitPrice * quantity * profitRate);

    return {
      target,
      eligible: true,
      unitPrice,
      pageUnits,
      profitRate,
      bindingCost,
      shippingCost: 0,
      formula: `ceil(${pages}P ÷ 16) = ${pageUnits} × ${unitPrice}円 × ${quantity.toLocaleString('ja-JP')}冊 × 利益${profitRate.toFixed(1)}`,
    };
  }

  return {
    target: '',
    eligible: false,
    unitPrice: 0,
    pageUnits: 0,
    profitRate,
    bindingCost: 0,
    shippingCost: 0,
    formula: '',
  };
}

function calcNeededPaper(detail) {
  const quantity = nonNegativeInteger(detail.quantity);
  const pages = nonNegativeInteger(detail.pages);
  const colors = Math.max(0, toNumberLoose(detail.colors));
  const imposition = getPaperImpositionSize(detail.size);
  const sideFactor = detail.is_double_sided ? 2 : 1;
  const pageDiv = Math.max(1, Math.ceil(pages / imposition));
  const base = Math.ceil((quantity * pages) / imposition);

  if (detail.machine === 'VP') {
    return base + colors * 70 * sideFactor * pageDiv;
  }

  if (detail.machine === 'GTO') {
    return base + colors * 30 * sideFactor * pageDiv;
  }

  return base;
}

function calcPaperCost({ neededPaper, paperThickness, paperUnitPrice }) {
  const reams = Math.max(0, toNumberLoose(neededPaper)) / 1000;
  const thickness = Math.max(0, toNumberLoose(paperThickness));
  const unitPrice = Math.max(0, toNumberLoose(paperUnitPrice));
  return reams * thickness * unitPrice * 1.2;
}

function calcPlateCost(detail) {
  if (detail.machine === 'オンデマンド') return 0;

  const colors = Math.max(0, toNumberLoose(detail.colors));
  const sideFactor = detail.is_double_sided ? 2 : 1;
  const pageDiv = getProductionPageDiv(detail.pages, detail.size);

  return colors * sideFactor * Math.max(0, toNumberLoose(detail.plate_unit_cost)) * pageDiv;
}

function calcPrintCost(detail) {
  const colors = Math.max(0, toNumberLoose(detail.colors));
  const sideFactor = detail.is_double_sided ? 2 : 1;
  const printUnit = Math.max(0, toNumberLoose(detail.print_unit_cost));
  const quantity = nonNegativeInteger(detail.quantity);
  const pages = nonNegativeInteger(detail.pages);

  if (detail.machine === 'オンデマンド') {
    const imposition = getPaperImpositionSize(detail.size);
    const baseCount = Math.ceil((quantity * pages) / imposition);
    return printUnit * baseCount * 4;
  }

  if (detail.machine === 'VP' || detail.machine === 'GTO') {
    const pageDiv = getProductionPageDiv(pages, detail.size);
    return colors * sideFactor * printUnit * pageDiv;
  }

  return 0;
}

function calcDesignCost(detail) {
  if (detail.design_type === 'outsourced') {
    return (
      Math.max(0, toNumberLoose(detail.design_outsource_cost)) *
      Math.max(0, toRateLoose(detail.design_profit_rate, 1))
    );
  }

  return (
    Math.max(0, toNumberLoose(detail.design_inhouse_unit_cost)) *
    nonNegativeInteger(detail.pages)
  );
}

function calculateDetail(detail) {
  const designCost = calcDesignCost(detail);
  const bindingCost = Math.max(0, toNumberLoose(detail.binding_cost));
  const shippingCost = Math.max(0, toNumberLoose(detail.shipping_cost));

  if (detail.print_type === 'outsourced') {
    const printCost =
      Math.max(0, toNumberLoose(detail.print_outsource_cost)) *
      Math.max(0, toRateLoose(detail.print_profit_rate, 1));
    const printTotalCost = printCost + bindingCost + shippingCost;

    return {
      designCost,
      neededPaper: 0,
      paperCost: 0,
      plateCost: 0,
      printCost,
      bindingCost,
      shippingCost,
      printTotalCost,
      totalEstimatedCost: designCost + printTotalCost,
      productionPageDiv: getProductionPageDiv(detail.pages, detail.size),
      printRunQuantity:
        detail.size === 'A6'
          ? Math.ceil(nonNegativeInteger(detail.quantity) / 2)
          : nonNegativeInteger(detail.quantity),
    };
  }

  const neededPaper = calcNeededPaper(detail);
  const paperCost = calcPaperCost({
    neededPaper,
    paperThickness: detail.paper_thickness,
    paperUnitPrice: detail.paper_unit_price,
  });
  const plateCost = calcPlateCost(detail);
  const printCost = calcPrintCost(detail);
  const printTotalCost =
    paperCost + plateCost + printCost + bindingCost + shippingCost;

  return {
    designCost,
    neededPaper,
    paperCost,
    plateCost,
    printCost,
    bindingCost,
    shippingCost,
    printTotalCost,
    totalEstimatedCost: designCost + printTotalCost,
    productionPageDiv: getProductionPageDiv(detail.pages, detail.size),
    printRunQuantity:
      detail.size === 'A6'
        ? Math.ceil(nonNegativeInteger(detail.quantity) / 2)
        : nonNegativeInteger(detail.quantity),
  };
}

function detailToForm(detail, initialQuantity) {
  const fallback = createInitialDetail(initialQuantity);
  return {
    detail_type: detail.detail_type ?? fallback.detail_type,
    size: detail.size ?? fallback.size,
    quantity: String(detail.quantity ?? fallback.quantity),
    pages: String(detail.pages ?? fallback.pages),
    colors: String(detail.colors ?? fallback.colors),
    is_double_sided: Boolean(detail.is_double_sided),
    binding_method: detail.binding_method ?? '',
    binding_profit_rate: String(detail.binding_profit_rate ?? '1.1'),
    binding_auto_calculated: Boolean(detail.binding_auto_calculated),
    shipping_auto_calculated: Boolean(detail.shipping_auto_calculated),

    design_type: detail.design_type || 'inhouse',
    design_outsource_cost: String(detail.design_outsource_cost ?? '0'),
    design_profit_rate: String(detail.design_profit_rate ?? '1.1'),
    design_inhouse_unit_cost: String(detail.design_inhouse_unit_cost ?? '0'),

    print_type: detail.print_type || 'inhouse',
    print_outsource_cost: String(detail.print_outsource_cost ?? '0'),
    print_profit_rate: String(detail.print_profit_rate ?? '1.1'),

    machine: detail.machine || 'VP',
    paper_type: detail.paper_type ?? fallback.paper_type,
    paper_thickness: String(detail.paper_thickness ?? fallback.paper_thickness),
    paper_unit_price: String(detail.paper_unit_price ?? fallback.paper_unit_price),
    plate_unit_cost: String(detail.plate_unit_cost ?? fallback.plate_unit_cost),
    print_unit_cost: String(detail.print_unit_cost ?? fallback.print_unit_cost),
    binding_cost: String(detail.binding_cost ?? '0'),
    shipping_cost: String(detail.shipping_cost ?? '0'),
  };
}

export default function EstimateForm({
  estimateId,
  initialQuantity = 0,
  onDetailsLoaded,
  meta = {},
}) {
  const [detailList, setDetailList] = useState([]);
  const [newDetail, setNewDetail] = useState(() => createInitialDetail(initialQuantity));
  const [editingDetailId, setEditingDetailId] = useState('');
  const [quantityManuallyEdited, setQuantityManuallyEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const onDetailsLoadedRef = useRef(onDetailsLoaded);

  useEffect(() => {
    onDetailsLoadedRef.current = onDetailsLoaded;
  }, [onDetailsLoaded]);

  const fetchDetails = useCallback(async () => {
    if (!estimateId) return;

    setError('');
    const { data, error: fetchError } = await supabase
      .from('estimate_details')
      .select('*')
      .eq('estimate_id', estimateId)
      .order('created_at', { ascending: true });

    if (fetchError) {
      // eslint-disable-next-line no-console
      console.error(fetchError);
      setError(fetchError.message || '見積明細の取得に失敗しました');
      return;
    }

    const list = data || [];
    setDetailList(list);
    onDetailsLoadedRef.current?.(list);
  }, [estimateId]);

  useEffect(() => {
    setEditingDetailId('');
    setQuantityManuallyEdited(false);
    setNewDetail(createInitialDetail(initialQuantity));
    fetchDetails();
  }, [estimateId, fetchDetails, initialQuantity]);

  useEffect(() => {
    if (editingDetailId || quantityManuallyEdited || Number(initialQuantity) <= 0) return;
    setNewDetail((previous) => ({
      ...previous,
      quantity: String(Math.max(0, Math.round(Number(initialQuantity)))),
    }));
  }, [editingDetailId, initialQuantity, quantityManuallyEdited]);

  const autoFinishing = useMemo(
    () => calculateAutoFinishing(newDetail),
    [
      newDetail.binding_method,
      newDetail.binding_profit_rate,
      newDetail.detail_type,
      newDetail.pages,
      newDetail.quantity,
      newDetail.size,
    ],
  );

  useEffect(() => {
    setNewDetail((previous) => {
      let changed = false;
      const next = { ...previous };

      if (previous.binding_auto_calculated) {
        const nextBinding = String(
          Math.round(autoFinishing.eligible ? autoFinishing.bindingCost : 0),
        );
        if (next.binding_cost !== nextBinding) {
          next.binding_cost = nextBinding;
          changed = true;
        }
      }

      if (previous.shipping_auto_calculated) {
        const nextShipping = String(
          Math.round(autoFinishing.target === 'COVER' ? autoFinishing.shippingCost : 0),
        );
        if (next.shipping_cost !== nextShipping) {
          next.shipping_cost = nextShipping;
          changed = true;
        }
      }

      return changed ? next : previous;
    });
  }, [autoFinishing]);

  const preview = useMemo(() => calculateDetail(newDetail), [newDetail]);
  const recommendedBindingMethods = useMemo(
    () => getRecommendedBindingMethods(newDetail),
    [newDetail.detail_type, newDetail.size],
  );

  const handleChange = (event) => {
    const { name, type, checked, value } = event.target;

    if (name === 'quantity') setQuantityManuallyEdited(true);

    setNewDetail((previous) => {
      const next = {
        ...previous,
        [name]: type === 'checkbox' ? checked : value,
      };

      if (name === 'binding_cost') next.binding_auto_calculated = false;
      if (name === 'shipping_cost') next.shipping_auto_calculated = false;

      if (name === 'detail_type' || name === 'size') {
        const target = getBindingTarget(next);
        if (!target) {
          if (previous.binding_auto_calculated) next.binding_cost = '0';
          if (previous.shipping_auto_calculated) next.shipping_cost = '0';
          next.binding_auto_calculated = false;
          next.shipping_auto_calculated = false;
        } else {
          next.binding_auto_calculated = true;
          next.shipping_auto_calculated = target === 'COVER';
        }
      }

      return next;
    });
  };

  const changeBindingMethod = (value) => {
    const method = String(value || '');

    setNewDetail((previous) => {
      const next = { ...previous, binding_method: method };
      const target = getBindingTarget(next);

      if (target) {
        next.binding_auto_calculated = true;
        next.shipping_auto_calculated = target === 'COVER';
      } else {
        if (previous.binding_auto_calculated) next.binding_cost = '0';
        if (previous.shipping_auto_calculated) next.shipping_cost = '0';
        next.binding_auto_calculated = false;
        next.shipping_auto_calculated = false;
      }

      return next;
    });
  };

  const changeBindingProfitRate = (value) => {
    setNewDetail((previous) => ({
      ...previous,
      binding_profit_rate: String(value ?? ''),
    }));
  };

  const enableBindingAutoCalculation = () => {
    if (!autoFinishing.eligible) {
      setError('A5/A6で、表紙または本文に対応した製本方法を選択してください');
      return;
    }

    setNewDetail((previous) => ({
      ...previous,
      binding_auto_calculated: true,
      shipping_auto_calculated: autoFinishing.target === 'COVER',
      binding_cost: String(Math.round(autoFinishing.bindingCost)),
      shipping_cost:
        autoFinishing.target === 'COVER'
          ? String(Math.round(autoFinishing.shippingCost))
          : previous.shipping_cost,
    }));
  };

  const enableShippingAutoCalculation = () => {
    if (autoFinishing.target !== 'COVER') {
      setError('発送費の自動計算は、A5/A6の表紙で「マットPP加工＆無線綴じ（巻取り）」を選択した場合のみ使用できます');
      return;
    }

    setNewDetail((previous) => ({
      ...previous,
      shipping_auto_calculated: true,
      shipping_cost: String(Math.round(autoFinishing.shippingCost)),
    }));
  };

  const startEdit = (detail) => {
    setError('');
    setSuccess('');
    setEditingDetailId(detail.id);
    setQuantityManuallyEdited(true);
    setNewDetail(detailToForm(detail, initialQuantity));
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  };

  const cancelEdit = () => {
    setEditingDetailId('');
    setQuantityManuallyEdited(false);
    setNewDetail(createInitialDetail(initialQuantity));
  };

  const deleteDetail = async (detailId) => {
    if (!window.confirm('この見積明細を削除します。よろしいですか？')) return;

    setBusy(true);
    setError('');
    setSuccess('');

    try {
      const { error: deleteError } = await supabase
        .from('estimate_details')
        .delete()
        .eq('id', detailId);
      if (deleteError) throw deleteError;

      if (editingDetailId === detailId) cancelEdit();
      await fetchDetails();
      setSuccess('見積明細を削除しました');
    } catch (deleteError) {
      // eslint-disable-next-line no-console
      console.error(deleteError);
      setError(deleteError?.message || '見積明細の削除に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const saveDetail = async () => {
    if (!estimateId) {
      setError('見積IDがありません');
      return;
    }

    const quantity = nonNegativeInteger(newDetail.quantity);
    const pages = nonNegativeInteger(newDetail.pages);
    if (quantity <= 0 || pages <= 0) {
      setError('数量とページ数は1以上で入力してください');
      return;
    }

    setBusy(true);
    setError('');
    setSuccess('');

    try {
      const calculated = calculateDetail(newDetail);
      const payload = {
        estimate_id: estimateId,
        detail_type: newDetail.detail_type,
        size: newDetail.size,
        quantity,
        pages,
        colors: String(newDetail.colors || ''),
        is_double_sided: Boolean(newDetail.is_double_sided),
        binding_method: String(newDetail.binding_method || '').trim(),
        binding_profit_rate: clampBindingProfitRate(newDetail.binding_profit_rate),
        binding_auto_calculated: Boolean(newDetail.binding_auto_calculated),
        shipping_auto_calculated: Boolean(newDetail.shipping_auto_calculated),

        design_type: newDetail.design_type,
        design_outsource_cost: Math.max(0, toNumberLoose(newDetail.design_outsource_cost)),
        design_profit_rate: Math.max(0, toRateLoose(newDetail.design_profit_rate, 1)),
        design_inhouse_unit_cost: Math.max(0, toNumberLoose(newDetail.design_inhouse_unit_cost)),
        design_cost: calculated.designCost,

        print_type: newDetail.print_type,
        print_outsource_cost: Math.max(0, toNumberLoose(newDetail.print_outsource_cost)),
        print_profit_rate: Math.max(0, toRateLoose(newDetail.print_profit_rate, 1)),

        machine: newDetail.machine,
        paper_type: String(newDetail.paper_type || '').trim(),
        paper_thickness: Math.max(0, toNumberLoose(newDetail.paper_thickness)),
        paper_unit_price: Math.max(0, toNumberLoose(newDetail.paper_unit_price)),
        plate_unit_cost: Math.max(0, toNumberLoose(newDetail.plate_unit_cost)),
        print_unit_cost: Math.max(0, toNumberLoose(newDetail.print_unit_cost)),
        binding_cost: calculated.bindingCost,
        shipping_cost: calculated.shippingCost,

        needed_paper: calculated.neededPaper,
        paper_cost: calculated.paperCost,
        plate_cost: calculated.plateCost,
        print_cost: calculated.printCost,
        print_total_cost: calculated.printTotalCost,
        processing_cost: calculated.bindingCost,
        total_estimated_cost: calculated.totalEstimatedCost,
      };

      if (editingDetailId) {
        const { error: updateError } = await supabase
          .from('estimate_details')
          .update(payload)
          .eq('id', editingDetailId);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from('estimate_details')
          .insert(payload);
        if (insertError) throw insertError;
      }

      await fetchDetails();
      const wasEditing = Boolean(editingDetailId);
      setEditingDetailId('');
      setQuantityManuallyEdited(false);
      setNewDetail(createInitialDetail(initialQuantity));
      setSuccess(wasEditing ? '見積明細を更新しました' : '価格を算出して見積明細を追加しました');
    } catch (saveError) {
      // eslint-disable-next-line no-console
      console.error(saveError);
      setError(saveError?.message || '見積明細の保存に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h6" fontWeight={900}>
          見積明細（計算・追加）
        </Typography>
        <Typography variant="body2" color="text.secondary">
          計画書の印刷手配数を数量の初期値として表示します。A6の製版・印刷は2丁製本として32P基準で台数計算します。
        </Typography>
      </Box>

      {error && <Alert severity="error">{error}</Alert>}
      {success && <Alert severity="success">{success}</Alert>}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} flexWrap="wrap" useFlexGap>
          <Chip
            label={`印刷手配数：${Math.max(0, Number(meta.printOrderQty || initialQuantity || 0)).toLocaleString('ja-JP')}冊`}
            color="primary"
            variant="outlined"
          />
          <Chip label={`納品工場：${meta.deliveryFactoryLabel || '-'}`} variant="outlined" />
          <Chip label={`注文番号：${meta.kawasakiOrderNo || '-'}`} variant="outlined" />
          {(meta.deliverySchedule || []).map((row, index) => (
            <Chip
              key={row.id || `${row.date}-${index}`}
              label={`${formatDateJa(row.date)} / ${Number(row.qty || 0).toLocaleString('ja-JP')}冊`}
              variant="outlined"
              color="error"
            />
          ))}
        </Stack>
      </Paper>

      <Paper sx={{ p: 1.5 }}>
        <Typography fontWeight={900} sx={{ mb: 1 }}>
          明細一覧（「詳細を見る・修正」で入力内容を復元）
        </Typography>
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 1420 }}>
            <TableHead>
              <TableRow>
                <TableCell>詳細</TableCell>
                <TableCell>サイズ・製本</TableCell>
                <TableCell align="right">数量</TableCell>
                <TableCell align="right">P</TableCell>
                <TableCell align="right">色</TableCell>
                <TableCell align="right">必要用紙</TableCell>
                <TableCell align="right">用紙代</TableCell>
                <TableCell align="right">製版代</TableCell>
                <TableCell align="right">印刷代</TableCell>
                <TableCell align="right">製本代</TableCell>
                <TableCell align="right">発送費</TableCell>
                <TableCell align="right">小計</TableCell>
                <TableCell align="right">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {detailList.map((detail) => (
                <TableRow key={detail.id} hover selected={editingDetailId === detail.id}>
                  <TableCell>{detail.detail_type || '-'}</TableCell>
                  <TableCell>
                    {detail.size || '-'}
                    {detail.binding_method ? ` / ${detail.binding_method}` : ''}
                    {detail.binding_auto_calculated ? '（自動）' : ''}
                  </TableCell>
                  <TableCell align="right">{Number(detail.quantity || 0).toLocaleString('ja-JP')}</TableCell>
                  <TableCell align="right">{detail.pages || 0}</TableCell>
                  <TableCell align="right">
                    {detail.colors || '-'} / {detail.is_double_sided ? '両面' : '片面'}
                  </TableCell>
                  <TableCell align="right">{Math.round(Number(detail.needed_paper || 0)).toLocaleString('ja-JP')}</TableCell>
                  <TableCell align="right">{yen(detail.paper_cost)}</TableCell>
                  <TableCell align="right">{yen(detail.plate_cost)}</TableCell>
                  <TableCell align="right">{yen(detail.print_cost)}</TableCell>
                  <TableCell align="right">{yen(detail.binding_cost)}</TableCell>
                  <TableCell align="right">{yen(detail.shipping_cost)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 900 }}>{yen(detail.total_estimated_cost)}</TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.7} justifyContent="flex-end">
                      <Button size="small" variant="outlined" onClick={() => startEdit(detail)}>
                        詳細を見る・修正
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        color="error"
                        onClick={() => deleteDetail(detail.id)}
                        disabled={busy}
                      >
                        削除
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}

              {detailList.length === 0 && (
                <TableRow>
                  <TableCell colSpan={13} sx={{ textAlign: 'center', color: 'text.secondary' }}>
                    明細がありません。
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      </Paper>

      <Divider />

      <Paper sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'center' }}>
            <Box sx={{ flex: 1 }}>
              <Typography fontWeight={900}>
                {editingDetailId ? '明細を修正' : '明細を追加（自動計算）'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                数字欄は「1,000部」「57.5K」「3,000円」などの自由入力に対応します。
              </Typography>
            </Box>
            {editingDetailId && (
              <Button variant="outlined" onClick={cancelEdit}>
                修正をやめる
              </Button>
            )}
          </Stack>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '220px minmax(0, 1fr)' },
              gap: 1.25,
              alignItems: 'center',
            }}
          >
            <Typography fontWeight={700}>詳細</Typography>
            <FormControl>
              <InputLabel id="estimate-detail-type-label">詳細</InputLabel>
              <Select
                labelId="estimate-detail-type-label"
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
              <InputLabel id="estimate-size-label">サイズ</InputLabel>
              <Select
                labelId="estimate-size-label"
                label="サイズ"
                name="size"
                value={newDetail.size}
                onChange={handleChange}
              >
                {['A3', 'A4', 'A5', 'A6', 'B4', 'B5'].map((size) => (
                  <MenuItem key={size} value={size}>{size}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <Typography fontWeight={700}>数量</Typography>
            <TextField
              name="quantity"
              value={newDetail.quantity}
              onChange={handleChange}
              placeholder="例：500冊"
              helperText={
                !quantityManuallyEdited && Number(initialQuantity) > 0
                  ? `計画書の印刷手配数 ${Number(initialQuantity).toLocaleString('ja-JP')}冊を自動反映中`
                  : '自由に変更できます'
              }
            />

            <Typography fontWeight={700}>ページ数</Typography>
            <TextField name="pages" value={newDetail.pages} onChange={handleChange} placeholder="例：216P" />

            <Typography fontWeight={700}>刷り色</Typography>
            <TextField name="colors" value={newDetail.colors} onChange={handleChange} placeholder="例：1色" />

            <Typography fontWeight={700}>片面・両面</Typography>
            <FormControlLabel
              control={
                <Checkbox
                  name="is_double_sided"
                  checked={newDetail.is_double_sided}
                  onChange={handleChange}
                />
              }
              label={newDetail.is_double_sided ? '両面' : '片面'}
            />

            <Typography fontWeight={700}>製本</Typography>
            <Autocomplete
              freeSolo
              options={recommendedBindingMethods}
              value={newDetail.binding_method}
              onChange={(_event, value) => changeBindingMethod(value || '')}
              onInputChange={(_event, value, reason) => {
                if (reason === 'input' || reason === 'clear') changeBindingMethod(value);
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  placeholder="選択または自由入力"
                  helperText={
                    recommendedBindingMethods.length > 0
                      ? `推奨選択：${recommendedBindingMethods.join(' / ')}。自由入力も可能です。`
                      : 'A5/A6の表紙・本文以外は自由入力です。'
                  }
                />
              )}
            />

            {(newDetail.size === 'A5' || newDetail.size === 'A6') &&
              (newDetail.detail_type === '表紙' || newDetail.detail_type === '本文') && (
                <>
                  <Typography fontWeight={700}>製本利益</Typography>
                  <Autocomplete
                    freeSolo
                    options={BINDING_PROFIT_OPTIONS}
                    value={newDetail.binding_profit_rate}
                    onChange={(_event, value) => changeBindingProfitRate(value || '')}
                    onInputChange={(_event, value, reason) => {
                      if (reason === 'input' || reason === 'clear') changeBindingProfitRate(value);
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        placeholder="1.1～2.0"
                        helperText={`計算時は1.1～2.0の範囲に補正します。現在：${clampBindingProfitRate(newDetail.binding_profit_rate).toFixed(1)}`}
                      />
                    )}
                  />
                </>
              )}

            <Typography fontWeight={700}>デザイン区分</Typography>
            <FormControl>
              <InputLabel id="estimate-design-type-label">デザイン区分</InputLabel>
              <Select
                labelId="estimate-design-type-label"
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
                <Typography fontWeight={700}>デザイン外注費</Typography>
                <TextField name="design_outsource_cost" value={newDetail.design_outsource_cost} onChange={handleChange} />
                <Typography fontWeight={700}>デザイン利益率</Typography>
                <TextField name="design_profit_rate" value={newDetail.design_profit_rate} onChange={handleChange} placeholder="例：1.1 / 110%" />
              </>
            ) : (
              <>
                <Typography fontWeight={700}>社内デザイン単価（円/P）</Typography>
                <TextField name="design_inhouse_unit_cost" value={newDetail.design_inhouse_unit_cost} onChange={handleChange} />
              </>
            )}

            <Typography fontWeight={700}>印刷区分</Typography>
            <FormControl>
              <InputLabel id="estimate-print-type-label">印刷区分</InputLabel>
              <Select
                labelId="estimate-print-type-label"
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
                <Typography fontWeight={700}>外注印刷仕入</Typography>
                <TextField name="print_outsource_cost" value={newDetail.print_outsource_cost} onChange={handleChange} />
                <Typography fontWeight={700}>外注印刷利益率</Typography>
                <TextField name="print_profit_rate" value={newDetail.print_profit_rate} onChange={handleChange} placeholder="例：1.1 / 110%" />
              </>
            ) : (
              <>
                <Typography fontWeight={700}>印刷機</Typography>
                <FormControl>
                  <InputLabel id="estimate-machine-label">印刷機</InputLabel>
                  <Select
                    labelId="estimate-machine-label"
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

                <Typography fontWeight={700}>用紙厚み（K）</Typography>
                <TextField name="paper_thickness" value={newDetail.paper_thickness} onChange={handleChange} />

                <Typography fontWeight={700}>用紙単価</Typography>
                <TextField name="paper_unit_price" value={newDetail.paper_unit_price} onChange={handleChange} />

                <Typography fontWeight={700}>製版単価</Typography>
                <TextField name="plate_unit_cost" value={newDetail.plate_unit_cost} onChange={handleChange} />

                <Typography fontWeight={700}>印刷単価</Typography>
                <TextField name="print_unit_cost" value={newDetail.print_unit_cost} onChange={handleChange} />
              </>
            )}

            <Typography fontWeight={700}>製本代</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'flex-start' }}>
              <TextField
                name="binding_cost"
                value={newDetail.binding_cost}
                onChange={handleChange}
                fullWidth
                helperText={
                  newDetail.binding_auto_calculated && autoFinishing.eligible
                    ? `自動計算：${autoFinishing.formula}`
                    : '自由入力。自動計算値を手修正すると自動計算OFFになります。'
                }
              />
              {autoFinishing.eligible && (
                <Button
                  variant={newDetail.binding_auto_calculated ? 'contained' : 'outlined'}
                  onClick={enableBindingAutoCalculation}
                  sx={{ minWidth: 150, mt: { sm: 0.5 } }}
                >
                  製本代を自動計算
                </Button>
              )}
            </Stack>

            <Typography fontWeight={700}>発送費</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'flex-start' }}>
              <TextField
                name="shipping_cost"
                value={newDetail.shipping_cost}
                onChange={handleChange}
                fullWidth
                helperText={
                  newDetail.shipping_auto_calculated && autoFinishing.target === 'COVER'
                    ? `表紙発送費を数量帯から自動計算：${yen(autoFinishing.shippingCost)}`
                    : '自由入力。表紙の指定条件を満たす場合のみ自動計算できます。'
                }
              />
              {autoFinishing.target === 'COVER' && (
                <Button
                  variant={newDetail.shipping_auto_calculated ? 'contained' : 'outlined'}
                  onClick={enableShippingAutoCalculation}
                  sx={{ minWidth: 150, mt: { sm: 0.5 } }}
                >
                  発送費を自動計算
                </Button>
              )}
            </Stack>
          </Box>

          <Divider />

          {newDetail.size === 'A6' && (
            <Alert severity="info">
              A6は2丁製本として、製版・印刷台数を「ページ数÷32」の切り上げで計算します。用紙必要数は従来通り64面付で計算します。印刷通し表示数量は数量÷2の切り上げです。
            </Alert>
          )}

          <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.default' }}>
            <Typography fontWeight={900}>計算プレビュー（税別）</Typography>
            <Box
              sx={{
                mt: 1,
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
                gap: 2,
              }}
            >
              <Box>
                <Typography variant="body2">デザイン費：{yen(preview.designCost)}</Typography>
                <Typography variant="body2">必要用紙：{Math.round(preview.neededPaper).toLocaleString('ja-JP')}枚</Typography>
                <Typography variant="body2">用紙代：{yen(preview.paperCost)}</Typography>
                <Typography variant="body2">製版代：{yen(preview.plateCost)}</Typography>
                <Typography variant="body2">印刷代：{yen(preview.printCost)}</Typography>
                <Typography variant="body2" sx={{ mt: 0.5, color: 'primary.light' }}>
                  製版・印刷台数：{preview.productionPageDiv}台
                  {newDetail.size === 'A6' ? '（32P基準）' : ''}
                </Typography>
                {newDetail.size === 'A6' && (
                  <Typography variant="body2" sx={{ color: 'primary.light' }}>
                    印刷通し表示数量：{preview.printRunQuantity.toLocaleString('ja-JP')}
                  </Typography>
                )}
              </Box>
              <Box>
                <Typography variant="body2">製本代：{yen(preview.bindingCost)}</Typography>
                <Typography variant="body2">発送費：{yen(preview.shippingCost)}</Typography>
                <Typography variant="body2">印刷関連総額：{yen(preview.printTotalCost)}</Typography>
                <Typography variant="h6" fontWeight={900} sx={{ mt: 0.5 }}>
                  小計：{yen(preview.totalEstimatedCost)}
                </Typography>
              </Box>
            </Box>
          </Paper>

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button variant="contained" onClick={saveDetail} disabled={busy}>
              {busy
                ? '保存中…'
                : editingDetailId
                  ? '再計算して明細を更新'
                  : '価格を算出して明細追加'}
            </Button>
            <Button variant="outlined" onClick={fetchDetails} disabled={busy}>
              再読み込み
            </Button>
            {editingDetailId && (
              <Button variant="text" onClick={cancelEdit} disabled={busy}>
                新規入力へ戻す
              </Button>
            )}
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  );
}
