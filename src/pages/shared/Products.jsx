import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
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

import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import meikoLogo from '../../assets/meiko-logo.png';

const PRODUCT_TYPE_LABELS = {
  ENGINE: '小型エンジン',
  OM: 'O/M',
  OTHER: 'その他',
};

const PRICE_CHANGE_ROWS_PER_PAGE = 14;

function productTypeLabel(value) {
  return PRODUCT_TYPE_LABELS[value] || String(value || '');
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

function nonNegativeInteger(value) {
  return Math.max(0, Math.round(safeNumber(value)));
}

function formatMoney(value) {
  return Math.round(safeNumber(value)).toLocaleString('ja-JP');
}

function formatUnitPrice(value) {
  const number = safeNumber(value);
  return number.toLocaleString('ja-JP', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function yen(value) {
  return `${formatMoney(value)}円`;
}

function formatReiwaDate(date = new Date()) {
  const reiwaYear = Math.max(1, date.getFullYear() - 2018);
  return `令和${String(reiwaYear).padStart(2, '0')}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function colorSlash(detail) {
  if (!detail) return '';
  const raw = String(detail.colors ?? '').trim();
  const color = raw.match(/\d+(?:\.\d+)?/)?.[0] || raw;
  if (!color) return '';
  return detail.is_double_sided ? `${color}/${color}` : `${color}/0`;
}

function firstDetailByType(details, types) {
  return details.find((detail) => types.includes(String(detail?.detail_type || ''))) || null;
}

function buildSpecification(details) {
  const list = Array.isArray(details) ? details : [];
  if (list.length === 0) return '-';

  const cover = firstDetailByType(list, ['表紙']);
  const body = firstDetailByType(list, ['本文']);
  const combined = firstDetailByType(list, ['表紙＋本文', '指定無し']);
  const representative = cover || body || combined || list[0];
  const parts = [];

  if (representative?.size) parts.push(String(representative.size));

  if (cover) {
    parts.push(`表紙${colorSlash(cover) || '-'}`);
  }

  if (body) {
    const pages = nonNegativeInteger(body.pages);
    parts.push(`本文${pages > 0 ? `${pages}P` : ''}${colorSlash(body) ? ` ${colorSlash(body)}` : ''}`);
  }

  if (!cover && !body && combined) {
    const pages = nonNegativeInteger(combined.pages);
    if (pages > 0) parts.push(`${pages}P`);
    if (colorSlash(combined)) parts.push(colorSlash(combined));
  }

  const binding = String(body?.binding_method || representative?.binding_method || '').trim();
  if (binding) parts.push(binding);

  return parts.filter(Boolean).join(' / ') || '-';
}

function naturalCompare(left, right) {
  return new Intl.Collator('ja-JP', {
    numeric: true,
    sensitivity: 'base',
  }).compare(String(left || ''), String(right || ''));
}

function chunkRows(rows, size) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function PriceChangePdfPage({ rows, pageNumber, pageCount }) {
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const blankRows = Array.from(
    { length: Math.max(0, PRICE_CHANGE_ROWS_PER_PAGE - rows.length) },
    (_, index) => index,
  );

  const cellStyle = {
    border: '1px solid #222',
    padding: '1.6mm 1mm',
    verticalAlign: 'middle',
    lineHeight: 1.35,
    wordBreak: 'break-word',
  };

  return (
    <div
      data-price-change-pdf-page="true"
      style={{
        width: '210mm',
        minHeight: '297mm',
        padding: '13mm 10mm 10mm',
        boxSizing: 'border-box',
        background: '#fff',
        color: '#111',
        fontFamily:
          '"Yu Gothic", "YuGothic", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif',
      }}
    >
      <div
        style={{
          textAlign: 'center',
          fontSize: '17pt',
          fontWeight: 700,
          letterSpacing: '0.38em',
          textDecoration: 'underline',
          textUnderlineOffset: '4px',
        }}
      >
        御 見 積 書
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '10mm',
          alignItems: 'start',
          marginTop: '7mm',
          marginBottom: '7mm',
        }}
      >
        <div style={{ fontSize: '9pt', lineHeight: 1.55 }}>
          <div style={{ fontWeight: 700 }}>カワサキモータース株式会社</div>
          <div style={{ fontWeight: 700 }}>調達統括部　調達管理部</div>
          <div style={{ fontWeight: 700 }}>調達管理課　御中</div>
          <div style={{ borderBottom: '1px solid #222', marginTop: '2mm', paddingBottom: '1mm' }}>
            価格変更対象について、下記の通り御見積り申し上げます。
          </div>
        </div>

        <div>
          <div style={{ textAlign: 'right', fontSize: '8.5pt', marginBottom: '3mm' }}>
            {formatReiwaDate(new Date())}
          </div>
          <div style={{ textAlign: 'center' }}>
            <img
              src={meikoLogo}
              alt="明光印刷株式会社"
              crossOrigin="anonymous"
              style={{ width: '62mm', maxHeight: '26mm', objectFit: 'contain' }}
            />
          </div>
        </div>
      </div>

      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          tableLayout: 'fixed',
          fontSize: '7.8pt',
        }}
      >
        <colgroup>
          <col style={{ width: '4%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '23%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '10%' }} />
        </colgroup>
        <thead>
          <tr style={{ background: '#f0f0f0' }}>
            {['No', '注文番号', '品番', '商品名', '商品種類', '仕様', '数量', '単価', '金額'].map(
              (label) => (
                <th key={label} style={{ ...cellStyle, textAlign: 'center', fontWeight: 700 }}>
                  {label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id} style={{ minHeight: '10mm' }}>
              <td style={{ ...cellStyle, textAlign: 'center' }}>
                {(pageNumber - 1) * PRICE_CHANGE_ROWS_PER_PAGE + index + 1}
              </td>
              <td style={cellStyle}>{row.orderNo || '未設定'}</td>
              <td style={cellStyle}>{row.productCode}</td>
              <td style={cellStyle}>{row.productName || '-'}</td>
              <td style={cellStyle}>{row.productTypeLabel}</td>
              <td style={{ ...cellStyle, fontSize: '7pt' }}>{row.specification}</td>
              <td style={{ ...cellStyle, textAlign: 'right' }}>
                {row.quantity.toLocaleString('ja-JP')}
              </td>
              <td style={{ ...cellStyle, textAlign: 'right' }}>
                {formatUnitPrice(row.unitPrice)}
              </td>
              <td style={{ ...cellStyle, textAlign: 'right' }}>
                {formatMoney(row.amount)}
              </td>
            </tr>
          ))}

          {blankRows.map((index) => (
            <tr key={`blank-${index}`} style={{ height: '10mm' }}>
              {Array.from({ length: 9 }, (_, cellIndex) => (
                <td key={cellIndex} style={cellStyle} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: '4mm',
          fontSize: '8pt',
        }}
      >
        <div>＜消費税別途＞</div>
        <div style={{ fontWeight: 700 }}>
          この頁の合計：¥{formatMoney(total)}
        </div>
        <div>
          {pageNumber} / {pageCount}頁
        </div>
      </div>
    </div>
  );
}

export default function Products() {
  const { role } = useAuth();
  const isStaff = role === 'staff' || role === 'admin';

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [drafts, setDrafts] = useState({});

  const priceListPdfRef = useRef(null);
  const priceChangePdfRef = useRef(null);

  const clearMessages = useCallback(() => {
    setError('');
    setSuccess('');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    clearMessages();

    try {
      const { data: productRows, error: productError } = await supabase
        .from('products')
        .select(
          `
            id,
            product_code,
            name,
            product_type,
            unit_price,
            price_quantity,
            initial_unit_price,
            initial_price_quantity,
            price_source_estimate_id,
            price_source_total,
            latest_kawasaki_order_no,
            latest_delivery_factory,
            price_change_selected,
            price_change_order_no,
            price_change_unit_price,
            price_change_quantity,
            price_change_note,
            price_change_updated_at,
            active,
            plan_registered,
            updated_at
          `,
        )
        .eq('active', true)
        .eq('plan_registered', true)
        .order('product_code', { ascending: true })
        .limit(1000);

      if (productError) throw productError;

      const products = productRows || [];
      const productIds = products.map((row) => row.id);
      let estimateRows = [];

      if (productIds.length > 0) {
        const { data, error: estimateError } = await supabase
          .from('estimates')
          .select(
            'id, product_id, created_at, quote_quantity, quote_unit_price, quote_total_amount, kawasaki_order_no, delivery_factory',
          )
          .in('product_id', productIds)
          .order('created_at', { ascending: false })
          .limit(5000);

        if (estimateError) throw estimateError;
        estimateRows = data || [];
      }

      const estimateById = new Map(estimateRows.map((estimate) => [estimate.id, estimate]));
      const latestEstimateByProduct = new Map();
      estimateRows.forEach((estimate) => {
        if (!latestEstimateByProduct.has(estimate.product_id)) {
          latestEstimateByProduct.set(estimate.product_id, estimate);
        }
      });

      const sourceEstimates = products
        .map(
          (product) =>
            estimateById.get(product.price_source_estimate_id) ||
            latestEstimateByProduct.get(product.id) ||
            null,
        )
        .filter(Boolean);
      const sourceEstimateIds = [...new Set(sourceEstimates.map((estimate) => estimate.id))];

      let detailRows = [];
      if (sourceEstimateIds.length > 0) {
        const { data, error: detailError } = await supabase
          .from('estimate_details')
          .select(
            'id, estimate_id, detail_type, size, quantity, pages, colors, is_double_sided, binding_method, created_at',
          )
          .in('estimate_id', sourceEstimateIds)
          .order('created_at', { ascending: true });

        if (detailError) throw detailError;
        detailRows = data || [];
      }

      const detailsByEstimate = new Map();
      detailRows.forEach((detail) => {
        const current = detailsByEstimate.get(detail.estimate_id) || [];
        current.push(detail);
        detailsByEstimate.set(detail.estimate_id, current);
      });

      const enriched = products.map((product) => {
        const sourceEstimate =
          estimateById.get(product.price_source_estimate_id) ||
          latestEstimateByProduct.get(product.id) ||
          null;
        const specification = buildSpecification(
          sourceEstimate ? detailsByEstimate.get(sourceEstimate.id) || [] : [],
        );

        return {
          ...product,
          sourceEstimate,
          specification,
          automaticOrderNo:
            product.latest_kawasaki_order_no || sourceEstimate?.kawasaki_order_no || '',
        };
      });

      setRows(enriched);
      setDrafts(
        Object.fromEntries(
          enriched.map((row) => [
            row.id,
            {
              unitPrice: row.unit_price ?? '',
              quantity: row.price_quantity ?? '',
              changeSelected: Boolean(row.price_change_selected),
              changeOrderNo:
                row.price_change_order_no ?? row.automaticOrderNo ?? '',
              changeUnitPrice:
                row.price_change_unit_price ?? row.unit_price ?? '',
              changeQuantity:
                row.price_change_quantity ?? row.price_quantity ?? '',
              changeNote: row.price_change_note ?? '',
            },
          ]),
        ),
      );
    } catch (loadError) {
      // eslint-disable-next-line no-console
      console.error(loadError);
      setError(loadError?.message || '単価・価格変更情報の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [clearMessages]);

  useEffect(() => {
    load();
  }, [load]);

  const updateDraft = (productId, patch) => {
    setDrafts((previous) => ({
      ...previous,
      [productId]: {
        ...(previous[productId] || {}),
        ...patch,
      },
    }));
  };

  const filteredRows = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return rows;

    return rows.filter((row) => {
      const draft = drafts[row.id] || {};
      return `${row.product_code} ${row.name || ''} ${productTypeLabel(row.product_type)} ${
        draft.changeOrderNo || row.automaticOrderNo || ''
      } ${row.specification || ''}`
        .toLowerCase()
        .includes(keyword);
    });
  }, [drafts, query, rows]);

  const buildUpdatePayload = (row) => {
    const draft = drafts[row.id] || {};
    const unitPriceText = String(draft.unitPrice ?? '').trim();
    const quantityText = String(draft.quantity ?? '').trim();
    const changeUnitText = String(draft.changeUnitPrice ?? '').trim();
    const changeQuantityText = String(draft.changeQuantity ?? '').trim();

    return {
      unit_price: unitPriceText === '' ? null : Math.max(0, safeNumber(unitPriceText)),
      price_quantity:
        quantityText === '' ? null : nonNegativeInteger(quantityText),
      price_change_selected: Boolean(draft.changeSelected),
      price_change_order_no:
        String(draft.changeOrderNo || '').trim() || null,
      price_change_unit_price:
        changeUnitText === '' ? null : Math.max(0, safeNumber(changeUnitText)),
      price_change_quantity:
        changeQuantityText === '' ? null : nonNegativeInteger(changeQuantityText),
      price_change_note: String(draft.changeNote || '').trim() || null,
      price_change_updated_at: Boolean(draft.changeSelected)
        ? new Date().toISOString()
        : row.price_change_updated_at,
    };
  };

  const saveRow = async (row) => {
    const { error: updateError } = await supabase
      .from('products')
      .update(buildUpdatePayload(row))
      .eq('id', row.id);

    if (updateError) throw updateError;
  };

  const handleSaveRow = async (row) => {
    setLoading(true);
    clearMessages();

    try {
      await saveRow(row);
      await load();
      setSuccess(`${row.product_code} の単価・価格変更設定を保存しました`);
    } catch (saveError) {
      // eslint-disable-next-line no-console
      console.error(saveError);
      setError(saveError?.message || '保存に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const saveAll = async () => {
    setLoading(true);
    clearMessages();

    try {
      for (const row of filteredRows) {
        await saveRow(row);
      }
      await load();
      setSuccess('表示中の商品を一括保存しました');
    } catch (saveError) {
      // eslint-disable-next-line no-console
      console.error(saveError);
      setError(saveError?.message || '一括保存に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const copyEstimateValuesToChange = (row) => {
    const draft = drafts[row.id] || {};
    updateDraft(row.id, {
      changeSelected: true,
      changeOrderNo:
        String(draft.changeOrderNo || row.automaticOrderNo || '').trim(),
      changeUnitPrice: draft.unitPrice ?? row.unit_price ?? '',
      changeQuantity: draft.quantity ?? row.price_quantity ?? '',
    });
  };

  const selectedChangeRows = useMemo(() => {
    return rows
      .map((row) => {
        const draft = drafts[row.id] || {};
        if (!draft.changeSelected) return null;

        const quantity = nonNegativeInteger(draft.changeQuantity);
        const unitPrice = Math.max(0, safeNumber(draft.changeUnitPrice));
        const orderNo = String(
          draft.changeOrderNo || row.automaticOrderNo || '',
        ).trim();

        return {
          id: row.id,
          orderNo,
          productCode: row.product_code,
          productName: row.name || '',
          productTypeLabel: productTypeLabel(row.product_type),
          specification: row.specification || '-',
          quantity,
          unitPrice,
          amount: quantity * unitPrice,
          note: String(draft.changeNote || '').trim(),
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (!left.orderNo && right.orderNo) return 1;
        if (left.orderNo && !right.orderNo) return -1;
        const orderComparison = naturalCompare(left.orderNo, right.orderNo);
        if (orderComparison !== 0) return orderComparison;
        return naturalCompare(left.productCode, right.productCode);
      });
  }, [drafts, rows]);

  const priceChangePages = useMemo(
    () => chunkRows(selectedChangeRows, PRICE_CHANGE_ROWS_PER_PAGE),
    [selectedChangeRows],
  );

  const downloadPriceListPdf = async () => {
    if (!priceListPdfRef.current) return;

    setLoading(true);
    clearMessages();

    try {
      const canvas = await html2canvas(priceListPdfRef.current, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        scrollY: 0,
        windowWidth: priceListPdfRef.current.scrollWidth,
        windowHeight: priceListPdfRef.current.scrollHeight,
      });

      const imageData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const margin = 8;
      const imageWidth = pdfWidth - margin * 2;
      const imageHeight = (canvas.height * imageWidth) / canvas.width;

      let y = margin;
      pdf.addImage(imageData, 'PNG', margin, y, imageWidth, imageHeight);

      let heightLeft = imageHeight - (pdfHeight - margin * 2);
      while (heightLeft > 0) {
        pdf.addPage();
        y = margin - (imageHeight - heightLeft);
        pdf.addImage(imageData, 'PNG', margin, y, imageWidth, imageHeight);
        heightLeft -= pdfHeight - margin * 2;
      }

      downloadBlob(pdf.output('blob'), 'product_unit_prices_and_quantities.pdf');
    } catch (pdfError) {
      // eslint-disable-next-line no-console
      console.error(pdfError);
      setError(pdfError?.message || '単価一覧PDFの作成に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const downloadPriceChangePdf = async () => {
    if (selectedChangeRows.length === 0) {
      setError('価格変更一覧PDFへ載せる商品を1件以上選択してください');
      return;
    }

    setLoading(true);
    clearMessages();

    try {
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const pageNodes = Array.from(
        priceChangePdfRef.current?.querySelectorAll('[data-price-change-pdf-page="true"]') || [],
      );

      if (pageNodes.length === 0) {
        throw new Error('価格変更一覧PDFの印刷対象がありません');
      }

      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();

      for (let index = 0; index < pageNodes.length; index += 1) {
        const canvas = await html2canvas(pageNodes[index], {
          scale: 2,
          backgroundColor: '#ffffff',
          useCORS: true,
          scrollY: 0,
          windowWidth: pageNodes[index].scrollWidth,
          windowHeight: pageNodes[index].scrollHeight,
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

      const date = new Date();
      const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(
        date.getDate(),
      ).padStart(2, '0')}`;
      downloadBlob(pdf.output('blob'), `price_change_estimate_${stamp}.pdf`);
    } catch (pdfError) {
      // eslint-disable-next-line no-console
      console.error(pdfError);
      setError(pdfError?.message || '価格変更一覧PDFの作成に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h4" fontWeight={900}>
            単価登録【数量・商品別単価】
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
            見積作成で保存した「見積り用の数量」と、見積合計を数量で割った単価を自動反映します。必要に応じて手動修正できます。
          </Typography>
        </Box>

        {error && <Alert severity="error">{error}</Alert>}
        {success && <Alert severity="success">{success}</Alert>}

        <Paper sx={{ p: 2 }}>
          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5}>
            <TextField
              fullWidth
              label="品番・商品名・注文番号・仕様で絞り込み"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />

            {isStaff && (
              <Button variant="contained" onClick={saveAll} disabled={loading}>
                表示中を一括保存
              </Button>
            )}

            <Button variant="outlined" onClick={downloadPriceListPdf} disabled={loading}>
              単価一覧PDF
            </Button>

            <Button
              variant="outlined"
              onClick={downloadPriceChangePdf}
              disabled={loading || selectedChangeRows.length === 0}
            >
              価格変更一覧PDF（{selectedChangeRows.length}件）
            </Button>

            <Button variant="outlined" onClick={load} disabled={loading}>
              再読み込み
            </Button>
          </Stack>
        </Paper>

        {loading && (
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={18} />
            <Typography variant="body2">処理中…</Typography>
          </Stack>
        )}

        <Paper sx={{ p: 2 }}>
          <Stack spacing={1.5}>
            <Box>
              <Typography variant="h6" fontWeight={900}>
                現在の単価・数量
              </Typography>
              <Typography variant="body2" color="text.secondary">
                見積PDF設定を保存すると自動更新されます。調整が必要な場合は、この表で直接修正して保存してください。
              </Typography>
            </Box>

            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 1080 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>品番</TableCell>
                    <TableCell>商品種類</TableCell>
                    <TableCell>商品名</TableCell>
                    <TableCell>初回単価</TableCell>
                    <TableCell>商品別単価</TableCell>
                    <TableCell>数量</TableCell>
                    <TableCell>見積仕様</TableCell>
                    <TableCell align="right">操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredRows.map((row) => {
                    const draft = drafts[row.id] || {};
                    return (
                      <TableRow key={row.id} hover>
                        <TableCell sx={{ fontWeight: 900 }}>{row.product_code}</TableCell>
                        <TableCell>{productTypeLabel(row.product_type)}</TableCell>
                        <TableCell>{row.name || '-'}</TableCell>
                        <TableCell>
                          {row.initial_unit_price == null
                            ? '-'
                            : `@${formatUnitPrice(row.initial_unit_price)}円`}
                        </TableCell>
                        <TableCell sx={{ minWidth: 180 }}>
                          <TextField
                            size="small"
                            value={draft.unitPrice ?? ''}
                            onChange={(event) =>
                              updateDraft(row.id, { unitPrice: event.target.value })
                            }
                            placeholder="例：482.00"
                            fullWidth
                            InputProps={{ readOnly: !isStaff }}
                          />
                        </TableCell>
                        <TableCell sx={{ minWidth: 160 }}>
                          <TextField
                            size="small"
                            value={draft.quantity ?? ''}
                            onChange={(event) =>
                              updateDraft(row.id, { quantity: event.target.value })
                            }
                            placeholder="例：500"
                            fullWidth
                            InputProps={{ readOnly: !isStaff }}
                          />
                        </TableCell>
                        <TableCell sx={{ minWidth: 280 }}>
                          <Typography variant="body2">{row.specification || '-'}</Typography>
                        </TableCell>
                        <TableCell align="right">
                          {isStaff ? (
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => handleSaveRow(row)}
                              disabled={loading}
                            >
                              保存
                            </Button>
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              閲覧のみ
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {filteredRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} sx={{ textAlign: 'center', color: 'text.secondary' }}>
                        計画書登録済みの商品がありません。
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
          </Stack>
        </Paper>

        <Paper sx={{ p: 2 }}>
          <Stack spacing={1.5}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={1}
              alignItems={{ md: 'center' }}
            >
              <Box sx={{ flex: 1 }}>
                <Typography variant="h6" fontWeight={900}>
                  価格変更一覧PDFの対象設定
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  価格変更届へ載せる商品を選択し、注文番号・変更数量・変更単価を確認または修正します。PDFは注文番号を英字・数字の自然順で並べます。
                </Typography>
              </Box>
              <Chip
                color={selectedChangeRows.length > 0 ? 'primary' : 'default'}
                label={`PDF対象 ${selectedChangeRows.length}件`}
              />
            </Stack>

            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 1580 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>対象</TableCell>
                    <TableCell>注文番号</TableCell>
                    <TableCell>品番・商品名</TableCell>
                    <TableCell>仕様</TableCell>
                    <TableCell>初回単価</TableCell>
                    <TableCell>変更数量</TableCell>
                    <TableCell>変更単価</TableCell>
                    <TableCell>変更後金額</TableCell>
                    <TableCell>備考</TableCell>
                    <TableCell align="right">操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredRows.map((row) => {
                    const draft = drafts[row.id] || {};
                    const changeQuantity = nonNegativeInteger(draft.changeQuantity);
                    const changeUnitPrice = Math.max(0, safeNumber(draft.changeUnitPrice));
                    const changeAmount = changeQuantity * changeUnitPrice;
                    const enabled = Boolean(draft.changeSelected);

                    return (
                      <TableRow key={`change-${row.id}`} hover selected={enabled}>
                        <TableCell>
                          <FormControlLabel
                            control={
                              <Checkbox
                                checked={enabled}
                                onChange={(event) =>
                                  updateDraft(row.id, {
                                    changeSelected: event.target.checked,
                                  })
                                }
                                disabled={!isStaff}
                              />
                            }
                            label={enabled ? '選択中' : '未選択'}
                          />
                        </TableCell>

                        <TableCell sx={{ minWidth: 210 }}>
                          <TextField
                            size="small"
                            value={draft.changeOrderNo ?? ''}
                            onChange={(event) =>
                              updateDraft(row.id, { changeOrderNo: event.target.value })
                            }
                            placeholder={row.automaticOrderNo || '注文番号を入力'}
                            fullWidth
                            disabled={!enabled || !isStaff}
                          />
                        </TableCell>

                        <TableCell sx={{ minWidth: 210 }}>
                          <Typography fontWeight={900}>{row.product_code}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {row.name || '-'} / {productTypeLabel(row.product_type)}
                          </Typography>
                        </TableCell>

                        <TableCell sx={{ minWidth: 300 }}>
                          <Typography variant="body2">{row.specification || '-'}</Typography>
                        </TableCell>

                        <TableCell sx={{ minWidth: 120 }}>
                          {row.initial_unit_price == null
                            ? '-'
                            : `@${formatUnitPrice(row.initial_unit_price)}円`}
                        </TableCell>

                        <TableCell sx={{ minWidth: 150 }}>
                          <TextField
                            size="small"
                            value={draft.changeQuantity ?? ''}
                            onChange={(event) =>
                              updateDraft(row.id, { changeQuantity: event.target.value })
                            }
                            fullWidth
                            disabled={!enabled || !isStaff}
                          />
                        </TableCell>

                        <TableCell sx={{ minWidth: 150 }}>
                          <TextField
                            size="small"
                            value={draft.changeUnitPrice ?? ''}
                            onChange={(event) =>
                              updateDraft(row.id, { changeUnitPrice: event.target.value })
                            }
                            fullWidth
                            disabled={!enabled || !isStaff}
                          />
                        </TableCell>

                        <TableCell sx={{ minWidth: 135, fontWeight: 900 }}>
                          {yen(changeAmount)}
                        </TableCell>

                        <TableCell sx={{ minWidth: 220 }}>
                          <TextField
                            size="small"
                            value={draft.changeNote ?? ''}
                            onChange={(event) =>
                              updateDraft(row.id, { changeNote: event.target.value })
                            }
                            placeholder="変更理由など（任意）"
                            fullWidth
                            disabled={!enabled || !isStaff}
                          />
                        </TableCell>

                        <TableCell align="right" sx={{ minWidth: 250 }}>
                          {isStaff ? (
                            <Stack direction="row" spacing={1} justifyContent="flex-end">
                              <Button
                                size="small"
                                variant="outlined"
                                onClick={() => copyEstimateValuesToChange(row)}
                              >
                                見積値を反映
                              </Button>
                              <Button
                                size="small"
                                variant="outlined"
                                onClick={() => handleSaveRow(row)}
                                disabled={loading}
                              >
                                保存
                              </Button>
                            </Stack>
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              閲覧のみ
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          </Stack>
        </Paper>

        {/* 単価一覧PDF用 */}
        <Box sx={{ position: 'absolute', top: -99999, left: -99999 }}>
          <Box
            ref={priceListPdfRef}
            sx={{
              width: 800,
              p: 3,
              bgcolor: '#fff',
              color: '#111',
              fontFamily:
                '"Yu Gothic", "YuGothic", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif',
            }}
          >
            <Typography variant="h5" fontWeight={900}>
              計画書登録済み商品　単価・数量一覧
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              出力日時：{new Date().toLocaleString('ja-JP')}
            </Typography>
            <Divider sx={{ my: 2, borderColor: '#999' }} />

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  {['品番', '商品種類', '商品名', '商品別単価', '数量'].map((label) => (
                    <th
                      key={label}
                      style={{ border: '1px solid #333', padding: 7, background: '#eee' }}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const draft = drafts[row.id] || {};
                  return (
                    <tr key={`pdf-${row.id}`}>
                      <td style={{ border: '1px solid #333', padding: 7 }}>{row.product_code}</td>
                      <td style={{ border: '1px solid #333', padding: 7 }}>
                        {productTypeLabel(row.product_type)}
                      </td>
                      <td style={{ border: '1px solid #333', padding: 7 }}>{row.name || ''}</td>
                      <td style={{ border: '1px solid #333', padding: 7, textAlign: 'right' }}>
                        {formatUnitPrice(draft.unitPrice)}円
                      </td>
                      <td style={{ border: '1px solid #333', padding: 7, textAlign: 'right' }}>
                        {nonNegativeInteger(draft.quantity).toLocaleString('ja-JP')}冊
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Box>
        </Box>

        {/* 価格変更一覧PDF用。1ページずつA4固定で生成します。 */}
        <Box sx={{ position: 'absolute', top: -99999, left: -99999 }}>
          <div ref={priceChangePdfRef}>
            {priceChangePages.map((pageRows, index) => (
              <PriceChangePdfPage
                key={`price-change-page-${index}`}
                rows={pageRows}
                pageNumber={index + 1}
                pageCount={priceChangePages.length}
              />
            ))}
          </div>
        </Box>
      </Stack>
    </Box>
  );
}
