import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';

import {
  Alert,
  Box,
  Button,
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

import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

const PRODUCT_TYPE_LABELS = {
  ENGINE: '小型エンジン',
  OM: 'O/M',
  OTHER: 'その他',
};

function productTypeLabel(value) {
  return PRODUCT_TYPE_LABELS[value] || value || '';
}

function safeNumber(value) {
  const normalized = String(value ?? '').replace(/,/g, '').replace(/[^\d.-]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function yen(value) {
  return `${Math.round(Number(value || 0)).toLocaleString('ja-JP')}円`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
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

  const pdfRef = useRef(null);

  const filteredRows = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return rows;
    return rows.filter((row) =>
      `${row.product_code} ${row.name || ''} ${productTypeLabel(row.product_type)}`
        .toLowerCase()
        .includes(keyword),
    );
  }, [query, rows]);

  const load = async () => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const { data, error: fetchError } = await supabase
        .from('products')
        .select(
          'id, product_code, name, product_type, unit_price, lot_unit_price, active, plan_registered, updated_at',
        )
        .eq('active', true)
        .eq('plan_registered', true)
        .order('product_code', { ascending: true })
        .limit(1000);

      if (fetchError) throw fetchError;

      const list = data || [];
      setRows(list);
      setDrafts(
        Object.fromEntries(
          list.map((row) => [
            row.id,
            {
              unitPrice: row.unit_price ?? '',
              lotUnitPrice: row.lot_unit_price ?? '',
            },
          ]),
        ),
      );
    } catch (loadError) {
      // eslint-disable-next-line no-console
      console.error(loadError);
      setError(loadError?.message || '単価一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const updateDraft = (productId, patch) => {
    setDrafts((previous) => ({
      ...previous,
      [productId]: {
        ...(previous[productId] || {}),
        ...patch,
      },
    }));
  };

  const saveRow = async (row) => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const draft = drafts[row.id] || {};
      const { error: updateError } = await supabase
        .from('products')
        .update({
          unit_price:
            String(draft.unitPrice ?? '').trim() === ''
              ? null
              : safeNumber(draft.unitPrice),
          lot_unit_price:
            String(draft.lotUnitPrice ?? '').trim() === ''
              ? null
              : safeNumber(draft.lotUnitPrice),
        })
        .eq('id', row.id);

      if (updateError) throw updateError;
      await load();
      setSuccess(`${row.product_code} の単価を保存しました`);
    } catch (saveError) {
      // eslint-disable-next-line no-console
      console.error(saveError);
      setError(saveError?.message || '単価の保存に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const saveAll = async () => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      for (const row of filteredRows) {
        const draft = drafts[row.id] || {};
        const { error: updateError } = await supabase
          .from('products')
          .update({
            unit_price:
              String(draft.unitPrice ?? '').trim() === ''
                ? null
                : safeNumber(draft.unitPrice),
            lot_unit_price:
              String(draft.lotUnitPrice ?? '').trim() === ''
                ? null
                : safeNumber(draft.lotUnitPrice),
          })
          .eq('id', row.id);

        if (updateError) throw updateError;
      }

      await load();
      setSuccess('表示中の単価をすべて保存しました');
    } catch (saveError) {
      // eslint-disable-next-line no-console
      console.error(saveError);
      setError(saveError?.message || '一括保存に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const downloadPdf = async () => {
    if (!pdfRef.current) return;

    setLoading(true);
    setError('');

    try {
      const canvas = await html2canvas(pdfRef.current, {
        scale: 2,
        backgroundColor: '#ffffff',
        scrollY: 0,
        windowWidth: pdfRef.current.scrollWidth,
        windowHeight: pdfRef.current.scrollHeight,
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

      downloadBlob(pdf.output('blob'), 'planned_product_unit_prices.pdf');
    } catch (pdfError) {
      // eslint-disable-next-line no-console
      console.error(pdfError);
      setError(pdfError?.message || '単価一覧PDFの作成に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h4" fontWeight={900}>
            単価登録【ロット単価・商品別単価】
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
            計画書（発注）に登録済みの品番だけを表示します。
          </Typography>
        </Box>

        {error && <Alert severity="error">{error}</Alert>}
        {success && <Alert severity="success">{success}</Alert>}

        <Paper sx={{ p: 2 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
            <TextField
              fullWidth
              label="品番・商品名で絞り込み"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {isStaff && (
              <Button variant="contained" onClick={saveAll} disabled={loading}>
                表示中を一括保存
              </Button>
            )}
            <Button variant="outlined" onClick={downloadPdf} disabled={loading}>
              単価一覧PDF
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
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 950 }}>
              <TableHead>
                <TableRow>
                  <TableCell>品番</TableCell>
                  <TableCell>商品種類</TableCell>
                  <TableCell>商品名</TableCell>
                  <TableCell>商品別単価</TableCell>
                  <TableCell>ロット単価</TableCell>
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
                      <TableCell sx={{ minWidth: 200 }}>
                        <TextField
                          size="small"
                          value={draft.unitPrice ?? ''}
                          onChange={(event) =>
                            updateDraft(row.id, { unitPrice: event.target.value })
                          }
                          placeholder="例：482"
                          fullWidth
                          InputProps={{ readOnly: !isStaff }}
                        />
                      </TableCell>
                      <TableCell sx={{ minWidth: 200 }}>
                        <TextField
                          size="small"
                          value={draft.lotUnitPrice ?? ''}
                          onChange={(event) =>
                            updateDraft(row.id, { lotUnitPrice: event.target.value })
                          }
                          placeholder="例：24,100"
                          fullWidth
                          InputProps={{ readOnly: !isStaff }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        {isStaff ? (
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => saveRow(row)}
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
                    <TableCell colSpan={6} sx={{ textAlign: 'center', color: 'text.secondary' }}>
                      計画書登録済みの商品がありません。
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Box>
        </Paper>

        {/* PDF用 */}
        <Box sx={{ position: 'absolute', top: -99999, left: -99999 }}>
          <Box
            ref={pdfRef}
            sx={{
              width: 800,
              p: 3,
              bgcolor: '#fff',
              color: '#111',
              fontFamily: 'sans-serif',
            }}
          >
            <Typography variant="h5" fontWeight={900}>
              計画書登録済み商品 単価一覧
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              出力日時：{new Date().toLocaleString('ja-JP')}
            </Typography>
            <Divider sx={{ my: 2, borderColor: '#999' }} />

            <table
              style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}
            >
              <thead>
                <tr>
                  {['品番', '商品種類', '商品名', '商品別単価', 'ロット単価'].map((label) => (
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
                        {yen(safeNumber(draft.unitPrice))}
                      </td>
                      <td style={{ border: '1px solid #333', padding: 7, textAlign: 'right' }}>
                        {yen(safeNumber(draft.lotUnitPrice))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Box>
        </Box>
      </Stack>
    </Box>
  );
}
