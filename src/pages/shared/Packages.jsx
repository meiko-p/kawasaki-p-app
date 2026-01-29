import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';

import {
  Alert,
  Autocomplete,
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

// =======================
// テンプレ画像（public/templates）
// =======================
const TEMPLATE_IMAGE = `${import.meta.env.BASE_URL}templates/shinseisyo.png`;
const STAMP_IMAGE = `${import.meta.env.BASE_URL}templates/kakuin.png`;

// =======================
// プレビューキャンバスサイズ（A4想定）
// =======================
const CANVAS_W = 840;
const CANVAS_H = 1188;

// shinseisyo.png の実寸（今回の添付から読み取ったサイズ）
// ※あなたのテンプレ画像が差し替わった場合はここを合わせてください
const TEMPLATE_W = 1383;
const TEMPLATE_H = 1971;

// テンプレ実寸 → CANVAS へスケーリング
const scaleX = (x) => (x * CANVAS_W) / TEMPLATE_W;
const scaleY = (y) => (y * CANVAS_H) / TEMPLATE_H;

// 文字の共通スタイル
const INPUT_STYLE = {
  position: 'absolute',
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: '#111',
  fontSize: 14,
  fontFamily: 'sans-serif',
};

// =======================
// 写真枠（テンプレ実寸ベース）
// 「枠内に収まる」ように、枠線より内側＆ラベル文字を避けた内側領域を指定
// =======================
const PHOTO_BOXES_TPL = [
  // 左上
  { key: 'p1', x: 98, y: 841, w: 587, h: 263 },
  // 右上
  { key: 'p2', x: 705, y: 841, w: 607, h: 263 },
  // 左下
  { key: 'p3', x: 98, y: 1148, w: 587, h: 259 },
  // 右下
  { key: 'p4', x: 705, y: 1148, w: 607, h: 259 },
];

const PHOTO_BOXES = PHOTO_BOXES_TPL.map((b) => ({
  ...b,
  x: scaleX(b.x),
  y: scaleY(b.y),
  w: scaleX(b.w),
  h: scaleY(b.h),
}));

// =======================
// 「3.梱包資材情報」チェック対象（選択肢）
// =======================
const MATERIAL_OPTIONS = [
  '台車',
  '通い箱',
  'パレティーナ',
  'カートンボックス',
  '仕切り板',
  '個包装',
  'パレット(リターナブル)',
  'パレット(ワンウェイ)',
  'その他',
];

// テンプレの「使用有無」□（小さい黒四角）の中心座標（テンプレ実寸ベース）
// ※✓を打つ位置
const MATERIAL_MARK_TPL = {
  台車: { x: 283, y: 534 },
  通い箱: { x: 283, y: 559 },
  パレティーナ: { x: 283, y: 584 },
  カートンボックス: { x: 283, y: 609 },
  仕切り板: { x: 283, y: 634 },
  個包装: { x: 283, y: 659 },
  'パレット(リターナブル)': { x: 283, y: 685 },
  'パレット(ワンウェイ)': { x: 283, y: 711 },
  その他: { x: 283, y: 749 },
};

// 同じ行のサイズ欄（W/D/H）の「だいたい中心」X（テンプレ実寸ベース）
const PACK_COL_X_TPL = {
  w: 561.5,
  d: 627.5,
  h: 671.5,
};

// ★ 工場表示
const DELIVERY_FACTORY_OPTIONS = [
  { value: '75', label: '75工場' },
  { value: '76', label: '76工場' },
  { value: '85', label: '85工場' },
  { value: '86', label: '86工場' },
];

function factoryLabel(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return DELIVERY_FACTORY_OPTIONS.find((x) => x.value === s)?.label || s;
}

const PRODUCT_TYPE_LABEL = {
  ENGINE: '小型エンジン',
  OM: 'O/M',
  OTHER: 'その他',
};
function productTypeLabel(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return PRODUCT_TYPE_LABEL[s] || s;
}

// =======================
// 便利関数
// =======================
function pad3(n) {
  const v = String(n || '').replace(/[^\d]/g, '');
  return v.padStart(3, '0').slice(0, 3);
}

function safeNum(v) {
  const s = String(v ?? '').trim();
  if (!s) return 0;
  const normalized = s.replace(/,/g, '').replace(/[^\d.-]/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function toISODate(v) {
  const s = String(v || '').trim();
  return s || null;
}

function pickFirstDeliveryDate(delivery_schedule) {
  const arr = Array.isArray(delivery_schedule) ? delivery_schedule : [];
  for (const r of arr) {
    if (r && r.date) return String(r.date);
  }
  return '';
}

async function signedUrlFor(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('app-files').createSignedUrl(path, 60 * 60 * 24 * 7);
  if (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    return null;
  }
  return data?.signedUrl || null;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function fileToDataUrl(file) {
  if (!file) return null;
  return await new Promise((resolve) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result);
    r.readAsDataURL(file);
  });
}

// html2canvas 直前に、img が全部読み込み済みか待つ（印鑑/写真の取りこぼし防止）
async function waitForImagesLoaded(rootEl) {
  const imgs = Array.from(rootEl.querySelectorAll('img'));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise((resolve) => {
          if (img.complete) return resolve(true);
          img.onload = () => resolve(true);
          img.onerror = () => resolve(true);
        })
    )
  );
}

// =======================
// メイン
// =======================
export default function Packages() {
  const { role } = useAuth();
  const isStaff = role === 'staff' || role === 'admin';

  const [params] = useSearchParams();
  const filterProductId = params.get('product_id') || '';

  // products マスタ
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);

  const [error, setError] = useState('');

  // 登録一覧
  const [rows, setRows] = useState([]);
  const [pdfUrlMap, setPdfUrlMap] = useState({});
  const [photoUrlMap, setPhotoUrlMap] = useState({}); // rowId -> {p1,p2,p3,p4}

  // 入力（検索）
  const [selectedProduct, setSelectedProduct] = useState(null);

  // 見積から自動反映したいもの
  const [lastEstimateMeta, setLastEstimateMeta] = useState({
    delivery_factory: '',
    kawasaki_order_no: '',
    delivery_schedule: [],
  });

  // 申請書入力（必須）
  const [issueDate, setIssueDate] = useState('');
  const [applyDate, setApplyDate] = useState('');
  const [lotQty, setLotQty] = useState('');
  const [moqQty, setMoqQty] = useState('');

  const [materialType, setMaterialType] = useState('');
  const [packW, setPackW] = useState('');
  const [packD, setPackD] = useState('');
  const [packH, setPackH] = useState('');

  const [unitWeight, setUnitWeight] = useState('');
  const [packageWeight, setPackageWeight] = useState('');

  // 5.写真（4枚）
  const [photo1, setPhoto1] = useState(null);
  const [photo2, setPhoto2] = useState(null);
  const [photo3, setPhoto3] = useState(null);
  const [photo4, setPhoto4] = useState(null);

  // 画像プレビュー用 DataURL
  const [photoDataUrl, setPhotoDataUrl] = useState({ p1: null, p2: null, p3: null, p4: null });

  // 手動修正できるよう、帳票に載る文字は overlay に集約
  const [overlay, setOverlay] = useState({
    makerCode: '79132',
    customerName: '明光印刷株式会社',
    staffName: '',
    partCode: '',
    itemName: '',
    modelName: '',
    inspection: '',
  });

  // 帳票DOM
  const formRef = useRef(null);

  // ========== derived ==========
  const inspectionCode = useMemo(() => {
    const f = String(lastEstimateMeta.delivery_factory || '').replace(/[^\d]/g, '');
    if (!f) return '';
    return `${pad3(f)}A`;
  }, [lastEstimateMeta.delivery_factory]);

  const derivedUnitSize = useMemo(() => {
    const w = safeNum(packW);
    const d = safeNum(packD);
    const h = safeNum(packH);
    const qty = safeNum(lotQty);

    const unitWmm = w > 0 ? Math.max(0, Math.floor(w - 1)) : '';
    const unitDmm = d > 0 ? Math.max(0, Math.floor(d - 1)) : '';
    const unitHmm = h > 0 && qty > 0 ? Math.max(0, Math.floor(h / qty)) : '';

    return { unitWmm, unitDmm, unitHmm };
  }, [packW, packD, packH, lotQty]);

  const canCreate = useMemo(() => {
    return (
      !!selectedProduct?.id &&
      !!issueDate &&
      !!applyDate &&
      safeNum(lotQty) > 0 &&
      safeNum(moqQty) > 0 &&
      !!materialType &&
      safeNum(packW) > 0 &&
      safeNum(packD) > 0 &&
      safeNum(packH) > 0 &&
      safeNum(unitWeight) > 0 &&
      safeNum(packageWeight) > 0 &&
      !!photo1 &&
      !!photo2 &&
      !!photo3 &&
      !!photo4
    );
  }, [
    selectedProduct,
    issueDate,
    applyDate,
    lotQty,
    moqQty,
    materialType,
    packW,
    packD,
    packH,
    unitWeight,
    packageWeight,
    photo1,
    photo2,
    photo3,
    photo4,
  ]);

  // ========== material row / mark ==========
  const materialMark = useMemo(() => {
    if (!materialType) return null;
    const tpl = MATERIAL_MARK_TPL[materialType];
    if (!tpl) return null;

    return {
      x: scaleX(tpl.x),
      y: scaleY(tpl.y),
      tplX: tpl.x,
      tplY: tpl.y,
    };
  }, [materialType]);

  const packRowTop = useMemo(() => {
    if (!materialMark) return null;
    return materialMark.y - 10;
  }, [materialMark]);

  const packColX = useMemo(() => {
    return {
      w: scaleX(PACK_COL_X_TPL.w),
      d: scaleX(PACK_COL_X_TPL.d),
      h: scaleX(PACK_COL_X_TPL.h),
    };
  }, []);

  // ========== load products ==========
  const loadProducts = async () => {
    const { data, error: fetchErr } = await supabase
      .from('products')
      .select('id, product_code, name, product_type')
      .eq('active', true)
      .order('product_code', { ascending: true })
      .limit(500);

    if (fetchErr) {
      // eslint-disable-next-line no-console
      console.error(fetchErr);
      setError(fetchErr.message || '商品マスタの取得に失敗しました');
      return;
    }
    setProducts(data || []);
  };

  // ========== load packages ==========
  const load = async () => {
    setLoading(true);
    setError('');

    const q = supabase
      .from('packages')
      .select('*, products(id, product_code, name, product_type)')
      .order('created_at', { ascending: false })
      .limit(100);

    const { data, error: fetchErr } = filterProductId ? await q.eq('product_id', filterProductId) : await q;

    setLoading(false);
    if (fetchErr) {
      // eslint-disable-next-line no-console
      console.error(fetchErr);
      setError(fetchErr.message || '申請書データの取得に失敗しました');
      return;
    }

    setRows(data || []);

    const nextPdfMap = {};
    const nextPhotoMap = {};

    for (const r of data || []) {
      if (r.pdf_path) nextPdfMap[r.id] = await signedUrlFor(r.pdf_path);

      const p = {};
      if (r.photo1_path) p.p1 = await signedUrlFor(r.photo1_path);
      if (r.photo2_path) p.p2 = await signedUrlFor(r.photo2_path);
      if (r.photo3_path) p.p3 = await signedUrlFor(r.photo3_path);
      if (r.photo4_path) p.p4 = await signedUrlFor(r.photo4_path);
      nextPhotoMap[r.id] = p;
    }

    setPdfUrlMap(nextPdfMap);
    setPhotoUrlMap(nextPhotoMap);
  };

  useEffect(() => {
    loadProducts();
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterProductId]);

  // ========== product select -> fetch latest estimate meta ==========
  const loadLatestEstimateForProduct = async (product) => {
    const productId = product?.id;
    if (!productId) return;

    const { data, error: estErr } = await supabase
      .from('estimates')
      .select('delivery_factory, kawasaki_order_no, delivery_schedule')
      .eq('product_id', productId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (estErr) {
      // eslint-disable-next-line no-console
      console.error(estErr);
      return;
    }

    const schedule = Array.isArray(data?.delivery_schedule) ? data.delivery_schedule : [];
    const firstDate = pickFirstDeliveryDate(schedule);

    setLastEstimateMeta({
      delivery_factory: data?.delivery_factory || '',
      kawasaki_order_no: data?.kawasaki_order_no || '',
      delivery_schedule: schedule,
    });

    if (firstDate) setApplyDate(firstDate);

    setOverlay((prev) => ({
      ...prev,
      partCode: product.product_code || '',
      itemName: productTypeLabel(product.product_type) || '',
      modelName: product.name || '',
      inspection: data?.delivery_factory ? `${pad3(data.delivery_factory)}A` : '',
    }));
  };

  useEffect(() => {
    if (!selectedProduct?.id) return;

    setOverlay((prev) => ({
      ...prev,
      partCode: selectedProduct.product_code || '',
      itemName: productTypeLabel(selectedProduct.product_type) || prev.itemName,
      modelName: selectedProduct.name || prev.modelName,
    }));

    loadLatestEstimateForProduct(selectedProduct);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProduct?.id]);

  useEffect(() => {
    if (!inspectionCode) return;
    setOverlay((prev) => ({ ...prev, inspection: inspectionCode }));
  }, [inspectionCode]);

  // 写真選択 → DataURL
  useEffect(() => {
    (async () => {
      const p1 = await fileToDataUrl(photo1);
      const p2 = await fileToDataUrl(photo2);
      const p3 = await fileToDataUrl(photo3);
      const p4 = await fileToDataUrl(photo4);
      setPhotoDataUrl({ p1, p2, p3, p4 });
    })();
  }, [photo1, photo2, photo3, photo4]);

  // ========== PDF生成 ==========
  const generatePdfBlob = async () => {
    const el = formRef.current;
    if (!el) throw new Error('帳票DOM参照がありません');

    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }

    // 画像（印鑑/写真）が読み込み済みか待つ
    await waitForImagesLoaded(el);

    const canvas = await html2canvas(el, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      allowTaint: true,
      scrollX: 0,
      scrollY: 0,
      windowWidth: el.offsetWidth,
      windowHeight: el.offsetHeight,
    });

    const imgData = canvas.toDataURL('image/png');

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = pdf.internal.pageSize.getHeight();

    // 縦横比維持でページ内にフィット（センタリング）
    const imgRatio = canvas.width / canvas.height;
    const pageRatio = pdfW / pdfH;

    let wMm;
    let hMm;
    let xMm;
    let yMm;

    if (imgRatio > pageRatio) {
      wMm = pdfW;
      hMm = pdfW / imgRatio;
      xMm = 0;
      yMm = (pdfH - hMm) / 2;
    } else {
      hMm = pdfH;
      wMm = pdfH * imgRatio;
      yMm = 0;
      xMm = (pdfW - wMm) / 2;
    }

    pdf.addImage(imgData, 'PNG', xMm, yMm, wMm, hMm);

    return pdf.output('blob');
  };

  // ========== create ==========
  const create = async () => {
    if (!canCreate) {
      alert('必須入力が未完了です（写真4枚含む）');
      return;
    }

    setLoading(true);
    setError('');

    let packageId = null;

    try {
      const productId = selectedProduct.id;

      const insertPayload = {
        form_type: 'shinseisyo',
        product_id: productId,
        issue_date: toISODate(issueDate),
        apply_date: toISODate(applyDate),
        lot_qty: Math.round(safeNum(lotQty)),
        moq_qty: Math.round(safeNum(moqQty)),
        material_type: materialType,
        pack_w_mm: Math.round(safeNum(packW)),
        pack_d_mm: Math.round(safeNum(packD)),
        pack_h_mm: Math.round(safeNum(packH)),
        unit_weight_kg: safeNum(unitWeight),
        package_weight_kg: safeNum(packageWeight),
        inspection_code: inspectionCode || null,
        delivery_factory: lastEstimateMeta.delivery_factory || null,
        order_no: lastEstimateMeta.kawasaki_order_no || null,
        fields_json: {
          overlay,
          derived: {
            unitW: derivedUnitSize.unitWmm,
            unitD: derivedUnitSize.unitDmm,
            unitH: derivedUnitSize.unitHmm,
          },
          estimate_meta: lastEstimateMeta,
        },
      };

      const { data: inserted, error: insErr } = await supabase.from('packages').insert(insertPayload).select('id').single();
      if (insErr) throw insErr;

      packageId = inserted.id;

      // 2) 写真4枚を Storage へ upload
      const baseDir = `shared/shinseisyo/${productId}/${packageId}`;

      const sanitizeName = (name) => String(name || 'file').replace(/[^\w.\-()]+/g, '_');

      const uploadOne = async (file, name) => {
        const safeName = sanitizeName(file.name);
        const path = `${baseDir}/${name}_${Date.now()}_${safeName}`;
        const { error: upErr } = await supabase.storage.from('app-files').upload(path, file, {
          upsert: true,
          contentType: file.type || 'image/jpeg',
        });
        if (upErr) throw upErr;
        return path;
      };

      const p1 = await uploadOne(photo1, 'photo1');
      const p2 = await uploadOne(photo2, 'photo2');
      const p3 = await uploadOne(photo3, 'photo3');
      const p4 = await uploadOne(photo4, 'photo4');

      // 3) PDF生成
      const pdfBlob = await generatePdfBlob();

      // 4) PDF を Storage に upload
      const pdfPath = `${baseDir}/shinseisyo_${Date.now()}.pdf`;
      const { error: pdfErr } = await supabase.storage.from('app-files').upload(pdfPath, pdfBlob, {
        upsert: true,
        contentType: 'application/pdf',
      });
      if (pdfErr) throw pdfErr;

      // 5) DB update（paths保存）
      const { error: updErr } = await supabase
        .from('packages')
        .update({
          photo1_path: p1,
          photo2_path: p2,
          photo3_path: p3,
          photo4_path: p4,
          pdf_path: pdfPath,
        })
        .eq('id', packageId);

      if (updErr) throw updErr;

      // 6) ダウンロードも実行
      downloadBlob(pdfBlob, `shinseisyo_${selectedProduct.product_code}.pdf`);

      // reset
      setSelectedProduct(null);
      setIssueDate('');
      setApplyDate('');
      setLotQty('');
      setMoqQty('');
      setMaterialType('');
      setPackW('');
      setPackD('');
      setPackH('');
      setUnitWeight('');
      setPackageWeight('');
      setPhoto1(null);
      setPhoto2(null);
      setPhoto3(null);
      setPhoto4(null);
      setPhotoDataUrl({ p1: null, p2: null, p3: null, p4: null });
      setOverlay({
        makerCode: '79132',
        customerName: '明光印刷株式会社',
        staffName: '',
        partCode: '',
        itemName: '',
        modelName: '',
        inspection: '',
      });

      await load();
      alert('申請書を作成し、PDF/写真をStorageへ保存しました（PDFはダウンロード済み）');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      const msg =
        err?.message ||
        err?.error_description ||
        (typeof err === 'string' ? err : '') ||
        '登録/保存に失敗しました（Consoleを確認してください）';
      setError(msg);
      alert('登録/保存に失敗しました（Consoleを確認してください）');

      // 途中で packages 行だけ作って失敗した場合、行だけ残るのが嫌なら削除
      // （storage側のゴミまで消すには別途removeが必要）
      if (packageId) {
        try {
          await supabase.from('packages').delete().eq('id', packageId);
        } catch (_e) {
          // ignore
        }
      }
    } finally {
      setLoading(false);
    }
  };

  // 既存データのPDF表示
  const openPdf = async (row) => {
    const url = pdfUrlMap[row.id] || (row.pdf_path ? await signedUrlFor(row.pdf_path) : null);
    if (!url) {
      alert('PDF URLを取得できません');
      return;
    }
    window.open(url, '_blank');
  };

  const removeRow = async (row) => {
    if (!window.confirm('この申請書データを削除します。よろしいですか？')) return;
    const { error: delErr } = await supabase.from('packages').delete().eq('id', row.id);
    if (delErr) {
      // eslint-disable-next-line no-console
      console.error(delErr);
      alert('削除に失敗しました');
      return;
    }
    await load();
  };

  const setOverlayField = (key, value) => {
    setOverlay((prev) => ({ ...prev, [key]: value }));
  };

  // 写真枠に画像を収める（必ず枠内 / 少し小さめ）
  const renderPhotoInBox = (box, dataUrl) => {
    if (!dataUrl) return null;
    return (
      <div
        key={box.key}
        style={{
          position: 'absolute',
          left: box.x,
          top: box.y,
          width: box.w,
          height: box.h,
          overflow: 'hidden',
          padding: 6,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          pointerEvents: 'none',
        }}
      >
        <img
          src={dataUrl}
          alt={box.key}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            display: 'block',
          }}
        />
      </div>
    );
  };

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h4" sx={{ fontWeight: 900, mb: 2 }}>
        梱包登録（納入荷姿申請書）— 画像上に入力 → PDF出力
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <CircularProgress size={18} />
          <Typography sx={{ opacity: 0.7 }}>処理中…</Typography>
        </Box>
      )}

      {/* 入力フォーム */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography sx={{ fontWeight: 900, mb: 1 }}>① 品番検索 → 自動反映</Typography>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <Autocomplete
            options={products}
            value={selectedProduct}
            onChange={(_e, v) => setSelectedProduct(v)}
            getOptionLabel={(o) => (o ? `${o.product_code} ${o.name || ''}` : '')}
            renderInput={(p) => <TextField {...p} label="品番で検索（選択）" placeholder="例：99811-0209" />}
            sx={{ flex: 1 }}
          />

          <TextField label="納品工場（見積から）" value={factoryLabel(lastEstimateMeta.delivery_factory) || ''} disabled sx={{ minWidth: 220 }} />

          <TextField label="検収（自動）" value={inspectionCode || ''} disabled sx={{ minWidth: 160 }} />
        </Stack>

        <Divider sx={{ my: 2 }} />

        <Typography sx={{ fontWeight: 900, mb: 1 }}>② 必須入力</Typography>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr 1fr' }, gap: 1 }}>
          <TextField type="date" label="発行日（申請書提出日）" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField type="date" label="適用予定日（最初の納品日）" value={applyDate} onChange={(e) => setApplyDate(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField label="1梱包に入る数量（ロット）" value={lotQty} onChange={(e) => setLotQty(e.target.value)} placeholder="例：5" />
          <TextField label="最小ロット数（MOQ）" value={moqQty} onChange={(e) => setMoqQty(e.target.value)} placeholder="例：80" />
        </Box>

        <Box sx={{ mt: 1, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr 1fr 1fr' }, gap: 1 }}>
          <Autocomplete
            options={MATERIAL_OPTIONS}
            value={materialType}
            onChange={(_e, v) => setMaterialType(v || '')}
            renderInput={(p) => <TextField {...p} label="3.梱包資材（仕様有無の対象）" placeholder="例：個包装" />}
          />
          <TextField label="梱包W（mm）" value={packW} onChange={(e) => setPackW(e.target.value)} placeholder="例：150" />
          <TextField label="梱包D（mm）" value={packD} onChange={(e) => setPackD(e.target.value)} placeholder="例：105" />
          <TextField label="梱包H（mm）" value={packH} onChange={(e) => setPackH(e.target.value)} placeholder="例：65" />
        </Box>

        <Box sx={{ mt: 1, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 2fr' }, gap: 1 }}>
          <TextField label="1冊の重さ（kg）" value={unitWeight} onChange={(e) => setUnitWeight(e.target.value)} placeholder="例：0.216" />
          <TextField label="梱包時の重さ（kg）" value={packageWeight} onChange={(e) => setPackageWeight(e.target.value)} placeholder="例：1.08" />
          <TextField label="担当者名（印鑑の横に表示）" value={overlay.staffName} onChange={(e) => setOverlayField('staffName', e.target.value)} placeholder="例：梶原 茂" />
        </Box>

        <Typography sx={{ mt: 1, opacity: 0.75, fontSize: 12 }}>
          ※ 単品部品サイズは自動計算：W/D は -1mm、H は 梱包H ÷ ロット数量（小数切捨て）
        </Typography>

        <Divider sx={{ my: 2 }} />

        <Typography sx={{ fontWeight: 900, mb: 1 }}>③ 写真（4枚必須）</Typography>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: 'center' }}>
          <Button component="label" variant="outlined">
            写真1（全体側面）
            <input hidden type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto1(e.target.files?.[0] || null)} />
          </Button>
          <Typography sx={{ opacity: 0.75, minWidth: 180 }}>{photo1 ? photo1.name : '未選択'}</Typography>

          <Button component="label" variant="outlined">
            写真2（斜め上）
            <input hidden type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto2(e.target.files?.[0] || null)} />
          </Button>
          <Typography sx={{ opacity: 0.75, minWidth: 180 }}>{photo2 ? photo2.name : '未選択'}</Typography>

          <Button component="label" variant="outlined">
            写真3（単品）
            <input hidden type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto3(e.target.files?.[0] || null)} />
          </Button>
          <Typography sx={{ opacity: 0.75, minWidth: 180 }}>{photo3 ? photo3.name : '未選択'}</Typography>

          <Button component="label" variant="outlined">
            写真4（梱包直前）
            <input hidden type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto4(e.target.files?.[0] || null)} />
          </Button>
          <Typography sx={{ opacity: 0.75, minWidth: 180 }}>{photo4 ? photo4.name : '未選択'}</Typography>
        </Stack>

        <Divider sx={{ my: 2 }} />

        <Stack direction="row" spacing={1} flexWrap="wrap">
          <Button variant="contained" onClick={create} disabled={!canCreate || loading}>
            A4申請書PDFを生成して保存（Storage）＋ダウンロード
          </Button>
          <Button variant="outlined" onClick={load}>
            再読み込み
          </Button>
        </Stack>
      </Paper>

      {/* 帳票プレビュー */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography sx={{ fontWeight: 900, mb: 1 }}>申請書プレビュー（画像上に自由入力・修正OK）</Typography>

        {!selectedProduct?.id ? (
          <Typography sx={{ opacity: 0.75 }}>まず品番を選択してください。</Typography>
        ) : (
          <Box
            ref={formRef}
            sx={{
              width: `${CANVAS_W}px`,
              height: `${CANVAS_H}px`,
              position: 'relative',
              backgroundImage: `url(${TEMPLATE_IMAGE})`,
              backgroundRepeat: 'no-repeat',
              backgroundSize: '100% 100%',
              backgroundPosition: 'left top',
              border: '1px solid rgba(0,0,0,0.2)',
              overflow: 'hidden',
              backgroundColor: '#fff',
            }}
          >
            {/* 印鑑 */}
            <img
              src={STAMP_IMAGE}
              alt="stamp"
              style={{
                position: 'absolute',
                right: 50,
                top: 78,
                width: 70,
                opacity: 0.95,
              }}
            />

            {/* 発行日 */}
            <input
              style={{ ...INPUT_STYLE, left: 380, top: 105, width: 120 }}
              value={issueDate ? issueDate.replaceAll('-', '/') : ''}
              onChange={(e) => setIssueDate(e.target.value.replaceAll('/', '-'))}
              placeholder="YYYY/MM/DD"
            />

            {/* 担当者名 */}
            <input
              style={{ ...INPUT_STYLE, left: 600, top: 105, width: 160 }}
              value={overlay.staffName}
              onChange={(e) => setOverlayField('staffName', e.target.value)}
              placeholder="梶原　茂"
            />

            {/* 適用予定日 */}
            <input
              style={{ ...INPUT_STYLE, left: 170, top: 165, width: 160, fontSize: 10 }}
              value={applyDate ? applyDate.replaceAll('-', '/') : ''}
              onChange={(e) => setApplyDate(e.target.value.replaceAll('/', '-'))}
              placeholder="YYYY/MM/DD"
            />

            {/* 部品番号 */}
            <input
              style={{ ...INPUT_STYLE, left: 70, top: 247, width: 200, fontSize: 10 }}
              value={overlay.partCode}
              onChange={(e) => setOverlayField('partCode', e.target.value)}
              placeholder="品番"
            />

            {/* 品名（商品種類ラベル） */}
            <input
              style={{ ...INPUT_STYLE, left: 280, top: 247, width: 240, fontSize: 12 }}
              value={overlay.itemName}
              onChange={(e) => setOverlayField('itemName', e.target.value)}
              placeholder="小型エンジン / O/M など"
            />

            {/* 検収 */}
            <input
              style={{ ...INPUT_STYLE, left: 430, top: 247, width: 120, fontSize: 11 }}
              value={overlay.inspection}
              onChange={(e) => setOverlayField('inspection', e.target.value)}
              placeholder="076A"
            />

            {/* 希望まとめ数（ロット） */}
            <input
              style={{ ...INPUT_STYLE, left: 450, top: 246, width: 60, fontSize: 12, textAlign: 'right' }}
              value={lotQty}
              onChange={(e) => setLotQty(e.target.value)}
              placeholder="5"
            />

            {/* 希望最小発注数（MOQ） */}
            <input
              style={{ ...INPUT_STYLE, left: 570, top: 246, width: 60, fontSize: 12, textAlign: 'right' }}
              value={moqQty}
              onChange={(e) => setMoqQty(e.target.value)}
              placeholder="80"
            />

            {/* 機種（＝商品名） */}
            <input
              style={{ ...INPUT_STYLE, left: 698, top: 246, width: 100, fontSize: 12 }}
              value={overlay.modelName}
              onChange={(e) => setOverlayField('modelName', e.target.value)}
              placeholder="機種"
            />

            {/* 仕様有無 □に ✓ */}
            {materialMark && (
              <div
                style={{
                  position: 'absolute',
                  left: materialMark.x - 6,
                  top: materialMark.y - 12,
                  fontSize: 18,
                  fontWeight: 900,
                  color: '#111',
                  lineHeight: 1,
                  pointerEvents: 'none',
                }}
              >
                ✓
              </div>
            )}

            {/* 3.梱包資材：W/D/H（選択行に追従） */}
            {materialMark && packRowTop != null && (
              <>
                <input
                  style={{ ...INPUT_STYLE, left: packColX.w - 25, top: packRowTop, width: 40, textAlign: 'right', fontSize: 12 }}
                  value={packW}
                  onChange={(e) => setPackW(e.target.value)}
                  placeholder="W"
                />
                <input
                  style={{ ...INPUT_STYLE, left: packColX.d - 25, top: packRowTop, width: 55, textAlign: 'right', fontSize: 12 }}
                  value={packD}
                  onChange={(e) => setPackD(e.target.value)}
                  placeholder="D"
                />
                <input
                  style={{ ...INPUT_STYLE, left: packColX.h - 25, top: packRowTop, width: 78, textAlign: 'right', fontSize: 12 }}
                  value={packH}
                  onChange={(e) => setPackH(e.target.value)}
                  placeholder="H"
                />
              </>
            )}

            {/* 単品重量 / 荷姿総重量 */}
            <input
              style={{ ...INPUT_STYLE, left: 640, top: 280, width: 80, textAlign: 'right' }}
              value={unitWeight}
              onChange={(e) => setUnitWeight(e.target.value)}
              placeholder="0.2"
            />
            <input
              style={{ ...INPUT_STYLE, left: 640, top: 295, width: 80, textAlign: 'right' }}
              value={packageWeight}
              onChange={(e) => setPackageWeight(e.target.value)}
              placeholder="1.00"
            />

            {/* 単品部品サイズ（W/D/H）※重ならないように調整 */}
            <input style={{ ...INPUT_STYLE, left: 635, top: 327, width: 45, textAlign: 'right', fontSize: 11 }} value={derivedUnitSize.unitWmm === '' ? '' : String(derivedUnitSize.unitWmm)} readOnly />
            <input style={{ ...INPUT_STYLE, left: 675, top: 327, width: 55, textAlign: 'right', fontSize: 11 }} value={derivedUnitSize.unitDmm === '' ? '' : String(derivedUnitSize.unitDmm)} readOnly />
            <input style={{ ...INPUT_STYLE, left: 735, top: 327, width: 55, textAlign: 'right', fontSize: 11 }} value={derivedUnitSize.unitHmm === '' ? '' : String(derivedUnitSize.unitHmm)} readOnly />

            {/* 写真4枚（枠内に必ず収める） */}
            {PHOTO_BOXES.map((b) => renderPhotoInBox(b, photoDataUrl[b.key]))}
          </Box>
        )}
      </Paper>

      {/* 登録一覧 */}
      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Typography sx={{ fontWeight: 900 }}>登録一覧</Typography>
          <Box sx={{ flex: 1 }} />
          <Button variant="outlined" onClick={load}>
            再読み込み
          </Button>
        </Box>

        <Divider sx={{ my: 2 }} />

        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>品番</TableCell>
              <TableCell>工場/検収</TableCell>
              <TableCell>発行日/適用予定日</TableCell>
              <TableCell>ロット/MOQ</TableCell>
              <TableCell>PDF</TableCell>
              <TableCell>写真</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} hover>
                <TableCell sx={{ fontWeight: 800 }}>
                  {r.products?.product_code || '-'}
                  <Typography sx={{ opacity: 0.7, fontSize: 12 }}>{r.products?.name || ''}</Typography>
                </TableCell>

                <TableCell>
                  {factoryLabel(r.delivery_factory) || '-'} / {r.inspection_code || '-'}
                </TableCell>

                <TableCell>
                  {r.issue_date || '-'} / {r.apply_date || '-'}
                </TableCell>

                <TableCell>
                  {r.lot_qty ?? '-'} / {r.moq_qty ?? '-'}
                </TableCell>

                <TableCell>
                  {r.pdf_path ? (
                    <Button size="small" variant="outlined" onClick={() => openPdf(r)}>
                      開く
                    </Button>
                  ) : (
                    '-'
                  )}
                </TableCell>

                <TableCell>
                  <Typography sx={{ fontSize: 12, opacity: 0.75 }}>
                    {photoUrlMap[r.id]?.p1 ? '1 ' : ''}
                    {photoUrlMap[r.id]?.p2 ? '2 ' : ''}
                    {photoUrlMap[r.id]?.p3 ? '3 ' : ''}
                    {photoUrlMap[r.id]?.p4 ? '4 ' : ''}
                  </Typography>
                </TableCell>

                <TableCell align="right">
                  {isStaff && (
                    <Button size="small" color="error" variant="outlined" onClick={() => removeRow(r)}>
                      削除
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}

            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} sx={{ opacity: 0.7 }}>
                  登録データがありません。
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <Typography sx={{ mt: 2, opacity: 0.7, fontSize: 12 }}>
          ※ メール送信機能は削除しました。PDF/写真は Storage（app-files）へ保存します。
        </Typography>
      </Paper>
    </Box>
  );
}
