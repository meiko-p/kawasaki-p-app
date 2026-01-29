import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box,
  Button,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { jsPDF } from 'jspdf';
import { supabase } from '../../supabaseClient';

const A4_W = 210;
const A4_H = 297;

export default function Labels() {
  const [params] = useSearchParams();
  const productId = params.get('product_id') || '';
  const presetQty = params.get('qty') || '';

  const [productCode, setProductCode] = useState('');
  const [qty, setQty] = useState(presetQty);
  const [labelsPerSheet, setLabelsPerSheet] = useState(12);

  const line2 = useMemo(() => {
    const q = (qty || '').toString().trim();
    return q ? `納品数 ${q}冊` : '納品数 ＿冊';
    
  }, [qty]);

  useEffect(() => {
    const load = async () => {
      if (!productId) return;
      const { data, error } = await supabase.from('products').select('product_code').eq('id', productId).single();
      if (error) {
        // eslint-disable-next-line no-console
        console.error(error);
        return;
      }
      setProductCode(data?.product_code || '');
    };
    load();
  }, [productId]);

  const generate = () => {
    const code = (productCode || '').trim();
    if (!code) {
      alert('商品番号を入力してください');
      return;
    }

    const n = Number(labelsPerSheet);
    if (!Number.isFinite(n) || n <= 0 || n > 12) {
      alert('ラベル枚数は1〜12で入力してください');
      return;
    }

    // 12面（2列×6行）を想定
    const cols = 2;
    const rows = 6;

    const marginX = 8;
    const marginY = 10;
    const gapX = 4;
    const gapY = 2;

    const labelW = (A4_W - marginX * 2 - gapX * (cols - 1)) / cols;
    const labelH = (A4_H - marginY * 2 - gapY * (rows - 1)) / rows;

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    pdf.setFont('helvetica', 'bold');

    let printed = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (printed >= n) break;
        printed += 1;

        const x = marginX + c * (labelW + gapX);
        const y = marginY + r * (labelH + gapY);

        const cx = x + labelW / 2;
        const cy = y + labelH / 2;

        // 枠線（デバッグ用: 必要ならコメント解除）
        // pdf.setDrawColor(220);
        // pdf.rect(x, y, labelW, labelH);

        // テキスト（中央2行）
        pdf.setFontSize(12);
        pdf.text(code, cx, cy - 3, { align: 'center' });
        pdf.setFontSize(12);
        pdf.text(line2, cx, cy + 5, { align: 'center' });
      }
    }

    pdf.save(`labels_${code.replace(/[^a-zA-Z0-9-_]+/g, '_')}.pdf`);
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 900, mb: 2 }}>
        ラベル（A4 12面）PDF
      </Typography>

      <Paper sx={{ p: 2 }}>
        <Typography sx={{ opacity: 0.75, mb: 2 }}>
          宛名ラベル（A4 12面）の中央に、商品番号と納品数を2行で印字します。
        </Typography>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr 1fr' }, gap: 1 }}>
          <TextField
            label="商品番号"
            value={productCode}
            onChange={(e) => setProductCode(e.target.value)}
            placeholder="例: 99817-0041"
          />
          <TextField
            label="納品数（冊）"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="例: 100"
          />
          <TextField
            label="出力ラベル枚数（1〜12）"
            value={labelsPerSheet}
            onChange={(e) => setLabelsPerSheet(e.target.value)}
            placeholder="12"
          />
        </Box>

        <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button onClick={generate}>
            PDF作成
          </Button>
          <Typography sx={{ opacity: 0.7, fontSize: 12 }}>
            ※ 細かい余白・ラベルサイズは運用するラベル用紙に合わせて調整してください（Labels.jsx の margin/gap）。
          </Typography>
        </Box>
      </Paper>
    </Box>
  );
}
