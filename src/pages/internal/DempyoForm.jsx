import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useReactToPrint } from 'react-to-print';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

import {
  Box,
  Button,
  Divider,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from '@mui/material';

// 伝票下絵テンプレ（public/forms 配下）
const formTemplates = {
  tezyun: { label: '手順票', src: '/forms/tezyun.jpg', width: 768, height: 1114 },
  koutei: { label: '工程表', src: '/forms/koutei.jpg', width: 768, height: 1114 },
  uriage: { label: '売上伝票', src: '/forms/uriage.jpg', width: 768, height: 1114 },
  tokusaki: { label: '得意先元帳', src: '/forms/tokusaki.jpg', width: 768, height: 1181 },
};

// PDFを保存する際のフォルダ名（Storage）
const INTERNAL_PDF_PREFIX = 'internal/dempyo';

const DempyoForm = () => {
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState('');
  const [estimates, setEstimates] = useState([]);
  const [selectedEstimate, setSelectedEstimate] = useState('');
  const [estimateDetails, setEstimateDetails] = useState(null);

  const [formType, setFormType] = useState('tezyun');

  const [manualFields, setManualFields] = useState({
    customerName: '',
    issueDate: '',
    deliveryDate: '',
    productName: '',
    quantity: '',
    unitPrice: '',
    totalAmount: '',
    note: '',
    staffName: '',
  });

  // 入庫確定の状態（dempyoテーブル）
  const [receiptInfo, setReceiptInfo] = useState(null);

  const formRef = useRef();
  const printRef = useRef();

  // localStorage key
  const getStorageKey = () => `dempyoFields_${formType}`;

  // localStorage load/save
  useEffect(() => {
    const stored = localStorage.getItem(getStorageKey());
    if (stored) setManualFields(JSON.parse(stored));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formType]);

  useEffect(() => {
    localStorage.setItem(getStorageKey(), JSON.stringify(manualFields));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualFields, formType]);

  // 1) 得意先取得
  const fetchClients = async () => {
    const { data, error } = await supabase.from('clients').select('id, name').order('name', { ascending: true });
    if (error) {
      console.error('Error fetching clients:', error);
      return;
    }
    setClients(data || []);
    if (!selectedClient && (data || []).length > 0) {
      setSelectedClient(data[0].id);
    }
  };

  // 2) 見積取得
  const fetchEstimates = async (clientId) => {
    const { data, error } = await supabase
      .from('estimates')
      .select('id, title, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching estimates:', error);
      return;
    }
    setEstimates(data || []);
    setSelectedEstimate('');
    setEstimateDetails(null);
    setReceiptInfo(null);
  };

  // 3) 見積明細取得
  const fetchEstimateDetails = async (estimateId) => {
    // 見積本体 + 明細
    const { data: est, error: estErr } = await supabase
      .from('estimates')
      .select('id, title, created_at, client_id, product_id, products(product_code, name), clients(name)')
      .eq('id', estimateId)
      .single();

    if (estErr) {
      console.error('Error fetching estimate header:', estErr);
      return;
    }

    const { data: detail, error: detailErr } = await supabase
      .from('estimate_details')
      .select('*')
      .eq('estimate_id', estimateId)
      .order('created_at', { ascending: true });

    if (detailErr) {
      console.error('Error fetching estimate details:', detailErr);
      return;
    }

    // 伝票に入れたい情報を作る（ここは運用に合わせて調整可能）
    const totalCost = (detail || []).reduce((sum, d) => sum + Number(d.total_estimated_cost || 0), 0);
    const qty = Number(detail?.[0]?.quantity || 0);
    const unitPrice = qty ? Math.round(totalCost / qty) : 0;

    setEstimateDetails({
      ...est,
      details: detail || [],
      totalCost,
      qty,
      unitPrice,
    });

    // 自動反映（手入力欄の初期値）
    setManualFields((prev) => ({
      ...prev,
      customerName: est.clients?.name || prev.customerName,
      issueDate: prev.issueDate || new Date().toISOString().slice(0, 10),
      productName: est.products?.product_code || prev.productName,
      quantity: prev.quantity || (qty ? String(qty) : ''),
      unitPrice: prev.unitPrice || (unitPrice ? String(unitPrice) : ''),
      totalAmount: prev.totalAmount || (totalCost ? String(totalCost) : ''),
    }));

    // 入庫状況を取得
    await fetchReceiptInfo(estimateId);
  };

  const fetchReceiptInfo = async (estimateId) => {
    const { data, error } = await supabase
      .from('dempyos')
      .select('*')
      .eq('estimate_id', estimateId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching receipt info:', error);
      return;
    }
    setReceiptInfo(data || null);
  };

  // 初期ロード
  useEffect(() => {
    fetchClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 得意先変更時
  useEffect(() => {
    if (selectedClient) fetchEstimates(selectedClient);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClient]);

  // 見積変更時
  useEffect(() => {
    if (selectedEstimate) fetchEstimateDetails(selectedEstimate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEstimate]);

  // 入庫確定（Q2: 伝票作成時（Dempyoでボタン））
  const confirmReceipt = async () => {
    if (!estimateDetails?.id) {
      alert('見積を選択してください');
      return;
    }
    if (!estimateDetails?.product_id) {
      alert('見積に紐づく商品がありません（estimates.product_id を設定してください）');
      return;
    }

    const qty = Number(manualFields.quantity || estimateDetails.qty || 0);
    if (!Number.isFinite(qty) || qty <= 0) {
      alert('入庫数量が不正です。数量を確認してください。');
      return;
    }

    const ok = window.confirm(`入庫を確定します（数量: ${qty}）。よろしいですか？\n※確定すると在庫INに反映されます。`);
    if (!ok) return;

    const payload = {
      estimate_id: estimateDetails.id,
      product_id: estimateDetails.product_id,
      received_qty: qty,
      received_at: new Date().toISOString(),
    };

    try {
      // 既存があれば更新、なければ挿入
      if (receiptInfo?.id) {
        if (receiptInfo.received_at) {
          alert('すでに入庫確定済みです');
          return;
        }
        const { error } = await supabase.from('dempyos').update(payload).eq('id', receiptInfo.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('dempyos').insert(payload);
        if (error) throw error;
      }

      await fetchReceiptInfo(estimateDetails.id);
      alert('入庫確定しました。在庫に反映されます。');
    } catch (e) {
      console.error(e);
      alert('入庫確定に失敗しました');
    }
  };

  // 印刷（ブラウザ）
  const handlePrint = useReactToPrint({
    content: () => printRef.current,
    documentTitle: `dempyo_${formType}_${selectedEstimate || 'no_estimate'}`,
  });

  // PDF生成（ダウンロード）
  const downloadPdf = async () => {
    if (!formRef.current) return;

    const template = formTemplates[formType];
    const canvas = await html2canvas(formRef.current, {
      scale: 2,
      useCORS: true,
      width: template.width,
      height: template.height,
    });

    const imgData = canvas.toDataURL('image/jpeg', 1.0);

    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = 210;
    const pdfHeight = 297;

    // 画像サイズをA4に合わせて縮尺
    pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);

    pdf.save(`dempyo_${formType}_${selectedEstimate || 'no_estimate'}.pdf`);
  };

  // 入力変更
  const handleFieldChange = (field, value) => {
    setManualFields((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  // 伝票座標（運用に合わせて調整）
  // ここは「フォーム下絵に対してどこに何を置くか」を決める座標です。
  // 例として、ある程度見やすい位置に配置しています。
  const positions = {
    customerName: { x: 80, y: 80 },
    issueDate: { x: 560, y: 80 },

    deliveryDate: { x: 560, y: 110 },

    productName: { x: 80, y: 150 },
    quantity: { x: 560, y: 150 },
    unitPrice: { x: 560, y: 180 },
    totalAmount: { x: 560, y: 210 },

    note: { x: 80, y: 240 },
    staffName: { x: 560, y: 260 },
  };

  const template = formTemplates[formType];

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {/* 選択UI */}
      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Box>
            <Typography sx={{ fontWeight: 900, mb: 0.5 }}>得意先</Typography>
            <Select
              value={selectedClient}
              onChange={(e) => setSelectedClient(e.target.value)}
              size="small"
              sx={{ minWidth: 260 }}
            >
              {clients.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </Select>
          </Box>

          <Box>
            <Typography sx={{ fontWeight: 900, mb: 0.5 }}>見積</Typography>
            <Select
              value={selectedEstimate}
              onChange={(e) => setSelectedEstimate(e.target.value)}
              size="small"
              sx={{ minWidth: 320 }}
            >
              <MenuItem value="">
                （選択してください）
              </MenuItem>
              {estimates.map((e) => (
                <MenuItem key={e.id} value={e.id}>
                  {e.title} / {(e.created_at || '').slice(0, 10)}
                </MenuItem>
              ))}
            </Select>
          </Box>

          <Box>
            <Typography sx={{ fontWeight: 900, mb: 0.5 }}>伝票種類</Typography>
            <Select value={formType} onChange={(e) => setFormType(e.target.value)} size="small">
              {Object.entries(formTemplates).map(([k, v]) => (
                <MenuItem key={k} value={k}>{v.label}</MenuItem>
              ))}
            </Select>
          </Box>

          <Box sx={{ flex: 1 }} />

          <Button variant="outlined" onClick={handlePrint}>
            印刷（ブラウザ）
          </Button>
          <Button variant="outlined" onClick={downloadPdf}>
            PDFダウンロード
          </Button>
        </Box>

        <Divider sx={{ my: 2 }} />

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button onClick={confirmReceipt} color="success">
            入庫確定（在庫IN）
          </Button>

          {receiptInfo?.received_at ? (
            <Typography sx={{ fontWeight: 900, color: 'green' }}>
              入庫確定済: {String(receiptInfo.received_at).slice(0, 10)} / 数量: {receiptInfo.received_qty}
            </Typography>
          ) : (
            <Typography sx={{ opacity: 0.7 }}>
              入庫未確定
            </Typography>
          )}

          <Typography sx={{ opacity: 0.6, fontSize: 12 }}>
            ※ Q2対応: 入庫は Dempyo画面の「入庫確定」ボタンで確定します。
          </Typography>
        </Box>
      </Paper>

      {/* 手入力UI */}
      <Paper sx={{ p: 2 }}>
        <Typography sx={{ fontWeight: 900, mb: 1 }}>手入力欄（下絵へ反映）</Typography>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' }, gap: 1 }}>
          <TextField label="得意先名" value={manualFields.customerName} onChange={(e) => handleFieldChange('customerName', e.target.value)} />
          <TextField label="発行日" value={manualFields.issueDate} onChange={(e) => handleFieldChange('issueDate', e.target.value)} placeholder="YYYY-MM-DD" />
          <TextField label="納期" value={manualFields.deliveryDate} onChange={(e) => handleFieldChange('deliveryDate', e.target.value)} placeholder="YYYY-MM-DD" />

          <TextField label="商品名/商品番号" value={manualFields.productName} onChange={(e) => handleFieldChange('productName', e.target.value)} />
          <TextField label="数量" value={manualFields.quantity} onChange={(e) => handleFieldChange('quantity', e.target.value)} />
          <TextField label="単価" value={manualFields.unitPrice} onChange={(e) => handleFieldChange('unitPrice', e.target.value)} />

          <TextField label="金額合計" value={manualFields.totalAmount} onChange={(e) => handleFieldChange('totalAmount', e.target.value)} />
          <TextField label="担当者" value={manualFields.staffName} onChange={(e) => handleFieldChange('staffName', e.target.value)} />
          <TextField label="備考" value={manualFields.note} onChange={(e) => handleFieldChange('note', e.target.value)} multiline minRows={2} />
        </Box>

        <Typography sx={{ mt: 1, opacity: 0.7, fontSize: 12 }}>
          ※ 下絵への配置座標は DempyoForm.jsx の positions を調整してください（実帳票に合わせる）。
        </Typography>
      </Paper>

      {/* 伝票プレビュー（テンプレ + 絶対配置） */}
      <Paper sx={{ p: 2 }}>
        <Typography sx={{ fontWeight: 900, mb: 1 }}>
          プレビュー（{template.label}）
        </Typography>

        <Box
          ref={formRef}
          sx={{
            position: 'relative',
            width: template.width,
            height: template.height,
            backgroundImage: `url(${template.src})`,
            backgroundSize: 'cover',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          {/* 文字配置 */}
          {Object.entries(positions).map(([field, pos]) => (
            <Box
              key={field}
              sx={{
                position: 'absolute',
                left: pos.x,
                top: pos.y,
                fontSize: 14,
                fontWeight: 800,
                color: '#111',
                textShadow: '0 0 2px rgba(255,255,255,0.6)',
                maxWidth: 620,
                whiteSpace: 'pre-wrap',
              }}
            >
              {manualFields[field]}
            </Box>
          ))}
        </Box>

        {/* 印刷用（同じ内容） */}
        <Box sx={{ position: 'absolute', left: -9999, top: -9999 }}>
          <div ref={printRef}>
            <div style={{ position: 'relative', width: template.width, height: template.height, backgroundImage: `url(${template.src})`, backgroundSize: 'cover' }}>
              {Object.entries(positions).map(([field, pos]) => (
                <div
                  key={field}
                  style={{
                    position: 'absolute',
                    left: pos.x,
                    top: pos.y,
                    fontSize: 14,
                    fontWeight: 800,
                    color: '#111',
                    maxWidth: 620,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {manualFields[field]}
                </div>
              ))}
            </div>
          </div>
        </Box>
      </Paper>

      {/* 見積情報（参考表示） */}
      {estimateDetails && (
        <Paper sx={{ p: 2 }}>
          <Typography sx={{ fontWeight: 900, mb: 1 }}>選択中の見積（参考）</Typography>
          <Typography sx={{ opacity: 0.85 }}>
            タイトル: {estimateDetails.title} / 作成日: {(estimateDetails.created_at || '').slice(0, 10)}
          </Typography>
          <Typography sx={{ opacity: 0.85 }}>
            商品: {estimateDetails.products?.product_code || '-'}
          </Typography>
          <Typography sx={{ opacity: 0.85 }}>
            概算合計: {Number(estimateDetails.totalCost || 0).toLocaleString('ja-JP')} 円 / 単価: {Number(estimateDetails.unitPrice || 0).toLocaleString('ja-JP')} 円
          </Typography>

          <Divider sx={{ my: 1.5 }} />

          <Typography sx={{ fontWeight: 900, mb: 1 }}>明細</Typography>
          {(estimateDetails.details || []).map((d) => (
            <Box key={d.id} sx={{ p: 1, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 2, mb: 1 }}>
              <Typography sx={{ fontWeight: 800 }}>
                {d.detail_type} / {d.size} / 数量: {d.quantity} / ページ: {d.pages}
              </Typography>
              <Typography sx={{ opacity: 0.75, fontSize: 12 }}>
                合計: {Number(d.total_estimated_cost || 0).toLocaleString('ja-JP')} 円
              </Typography>
            </Box>
          ))}
        </Paper>
      )}
    </Box>
  );
};

export default DempyoForm;

