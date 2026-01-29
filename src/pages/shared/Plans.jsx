import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext.jsx';
import Stamp from '../../components/Stamp.jsx';

import {
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';

const monthStart = (yyyyMm) => {
  const [y, m] = (yyyyMm || '').split('-').map((v) => Number(v));
  if (!y || !m) return null;
  const mm = String(m).padStart(2, '0');
  return `${y}-${mm}-01`;
};

const todayStr = () => new Date().toISOString().slice(0, 10);

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

export default function Plans() {
  const { role } = useAuth();
  const isStaff = role === 'staff' || role === 'admin';
  const [params] = useSearchParams();
  const filterProductId = params.get('product_id') || '';

  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [loading, setLoading] = useState(false);

  const [planDoc, setPlanDoc] = useState(null);
  const [planImageUrl, setPlanImageUrl] = useState(null);

  const [items, setItems] = useState([]);
  const [products, setProducts] = useState([]);

  // add item form
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [qty, setQty] = useState('');
  const [memo, setMemo] = useState('');

  const monthKey = useMemo(() => monthStart(month), [month]);

  const loadProducts = async () => {
    const { data, error } = await supabase
      .from('products')
      .select('id, product_code, name')
      .eq('active', true)
      .order('product_code', { ascending: true })
      .limit(200);

    if (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      return;
    }
    setProducts(data || []);
  };

  const load = async () => {
    if (!monthKey) return;
    setLoading(true);

    // 1) 月次ヘッダを取得（1ヶ月=1件運用）
    const { data: doc, error: docErr } = await supabase
      .from('plan_documents')
      .select('*')
      .eq('month', monthKey)
      .single();

    if (docErr && docErr.code !== 'PGRST116') {
      // PGRST116 = no rows
      // eslint-disable-next-line no-console
      console.error(docErr);
    }

    setPlanDoc(doc || null);

    // 画像の署名URL
    if (doc?.image_path) {
      const url = await signedUrlFor(doc.image_path);
      setPlanImageUrl(url);
    } else {
      setPlanImageUrl(null);
    }

    // 2) 明細を取得
    if (doc?.id) {
      const q = supabase
        .from('plan_items')
        .select('*, products(id, product_code, name)')
        .eq('plan_document_id', doc.id)
        .order('created_at', { ascending: true });

      const { data: its, error: itErr } = filterProductId
        ? await q.eq('product_id', filterProductId)
        : await q;

      if (itErr) {
        // eslint-disable-next-line no-console
        console.error(itErr);
      }

      setItems(its || []);
    } else {
      setItems([]);
    }

    setLoading(false);
  };

  useEffect(() => {
    loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKey, filterProductId]);

  const createDoc = async () => {
    if (!monthKey) return;
    const { data, error } = await supabase
      .from('plan_documents')
      .insert({ month: monthKey })
      .select('*')
      .single();

    if (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      alert('計画書の作成に失敗しました');
      return;
    }
    setPlanDoc(data);
    setItems([]);
  };

  const onUploadPlanImage = async (file) => {
    if (!planDoc?.id) {
      alert('先にこの月の計画書を作成してください');
      return;
    }
    if (!file) return;

    const path = `shared/plans/${planDoc.id}/${Date.now()}_${file.name}`;
    const { error: upErr } = await supabase.storage.from('app-files').upload(path, file, { upsert: true });
    if (upErr) {
      // eslint-disable-next-line no-console
      console.error(upErr);
      alert('アップロードに失敗しました');
      return;
    }

    const { error: dbErr } = await supabase
      .from('plan_documents')
      .update({ image_path: path })
      .eq('id', planDoc.id);

    if (dbErr) {
      // eslint-disable-next-line no-console
      console.error(dbErr);
      alert('DB更新に失敗しました');
      return;
    }

    await load();
  };

  const addItem = async () => {
    if (!planDoc?.id) {
      alert('先にこの月の計画書を作成してください');
      return;
    }
    if (!selectedProduct?.id) {
      alert('商品を選択してください');
      return;
    }
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) {
      alert('数量を正しく入力してください');
      return;
    }

    const { error } = await supabase.from('plan_items').insert({
      plan_document_id: planDoc.id,
      product_id: selectedProduct.id,
      quantity_needed: n,
      memo: memo?.trim() || null,
    });

    if (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      alert('追加に失敗しました');
      return;
    }

    setSelectedProduct(null);
    setQty('');
    setMemo('');
    await load();
  };

  const updateItem = async (id, patch) => {
    const { error } = await supabase.from('plan_items').update(patch).eq('id', id);
    if (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      alert('更新に失敗しました');
      return false;
    }
    return true;
  };

  const markArranged = async (it) => {
    const ok = await updateItem(it.id, { arranged_at: todayStr() });
    if (ok) await load();
  };

  const markDelivered = async (it) => {
    // delivered_qty 未入力なら quantity_needed
    const deliveredQty = it.delivered_qty ?? it.quantity_needed;
    const ok = await updateItem(it.id, { delivered_at: todayStr(), delivered_qty: deliveredQty });
    if (ok) await load();
  };

  const removeItem = async (it) => {
    if (!window.confirm('この行を削除します。よろしいですか？')) return;
    const { error } = await supabase.from('plan_items').delete().eq('id', it.id);
    if (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      alert('削除に失敗しました');
      return;
    }
    await load();
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 900, mb: 2 }}>
        計画書（発注）共有
      </Typography>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            label="対象月"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          {filterProductId && (
            <Chip
              label="この商品でフィルタ中"
              color="primary"
              variant="outlined"
            />
          )}
          <Box sx={{ flex: 1 }} />
          {!planDoc && (
            <Button onClick={createDoc}>
              この月の計画書を作成
            </Button>
          )}
          <Button onClick={load} variant="outlined">
            再読み込み
          </Button>
        </Box>

        {!planDoc && (
          <Typography sx={{ mt: 1, opacity: 0.7 }}>
            この月の計画書が未作成です。「作成」後に、商品番号と数量を登録してください。
          </Typography>
        )}
      </Paper>

      {/* 計画書画像 */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography sx={{ fontWeight: 900, mb: 1 }}>
          計画書（写真）
        </Typography>

        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <Box>
            <Button component="label" variant="outlined" disabled={!planDoc}>
              写真をアップロード（撮影可）
              <input
                hidden
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => onUploadPlanImage(e.target.files?.[0] || null)}
              />
            </Button>
            <Typography sx={{ mt: 1, opacity: 0.65, fontSize: 12 }}>
              画像は Storage（app-files/shared/plans/...）に保存されます。
            </Typography>
          </Box>

          {planImageUrl ? (
            <Box sx={{ maxWidth: 720, width: '100%' }}>
              <img
                src={planImageUrl}
                alt="plan"
                style={{ width: '100%', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)' }}
              />
            </Box>
          ) : (
            <Typography sx={{ opacity: 0.65 }}>
              画像が未登録です。
            </Typography>
          )}
        </Box>
      </Paper>

      {/* 明細（商品番号と数量） */}
      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography sx={{ fontWeight: 900 }}>
            必要数量（明細）
          </Typography>
          <Box sx={{ flex: 1 }} />
          {loading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={18} />
              <Typography sx={{ opacity: 0.7 }}>読み込み中…</Typography>
            </Box>
          )}
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* 追加フォーム */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr 2fr auto' }, gap: 1, alignItems: 'center', mb: 2 }}>
          <Autocomplete
            options={products}
            value={selectedProduct}
            onChange={(_e, v) => setSelectedProduct(v)}
            getOptionLabel={(o) => (o ? `${o.product_code} ${o.name || ''}` : '')}
            renderInput={(params2) => <TextField {...params2} label="商品" placeholder="商品番号で検索して選択" />}
          />
          <TextField
            label="数量"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="例: 100"
          />
          <TextField
            label="メモ（任意）"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="例: 6月分 / 特記事項"
          />
          <Button onClick={addItem} disabled={!planDoc}>
            追加
          </Button>
        </Box>

        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>商品番号</TableCell>
              <TableCell>名称</TableCell>
              <TableCell align="right">必要数量</TableCell>
              <TableCell>メモ</TableCell>
              <TableCell>手配</TableCell>
              <TableCell>納品</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((it) => {
              const p = it.products;
              const arranged = !!it.arranged_at;
              const delivered = !!it.delivered_at;

              const canEditByKawasaki = !isStaff && !arranged && !delivered;
              const canDelete = isStaff || canEditByKawasaki;

              return (
                <TableRow key={it.id} hover>
                  <TableCell sx={{ fontWeight: 800 }}>{p?.product_code || '-'}</TableCell>
                  <TableCell>{p?.name || '-'}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800 }}>
                    {Number(it.quantity_needed || 0).toLocaleString('ja-JP')}
                  </TableCell>
                  <TableCell>
                    {(isStaff || canEditByKawasaki) ? (
                      <TextField
                        value={it.memo || ''}
                        size="small"
                        fullWidth
                        onChange={(e) => {
                          const v = e.target.value;
                          setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, memo: v } : x)));
                        }}
                        onBlur={async () => {
                          await updateItem(it.id, { memo: it.memo?.trim() || null });
                        }}
                      />
                    ) : (
                      it.memo || '-'
                    )}
                  </TableCell>

                  {/* 手配 */}
                  <TableCell>
                    {arranged ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Stamp label="済" size={40} />
                        <Typography sx={{ fontWeight: 800 }}>{it.arranged_at}</Typography>
                      </Box>
                    ) : (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Chip size="small" label="未" variant="outlined" />
                        {isStaff && (
                          <Button size="small" variant="outlined" onClick={() => markArranged(it)}>
                            手配済
                          </Button>
                        )}
                      </Box>
                    )}
                  </TableCell>

                  {/* 納品 */}
                  <TableCell>
                    {delivered ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Stamp label="済" size={40} />
                        <Typography sx={{ fontWeight: 800 }}>{it.delivered_at}</Typography>
                      </Box>
                    ) : (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Chip size="small" label="未" variant="outlined" />
                        {isStaff && (
                          <Button size="small" variant="outlined" onClick={() => markDelivered(it)} disabled={!arranged}>
                            納品済
                          </Button>
                        )}
                      </Box>
                    )}
                    {isStaff && !delivered && (
                      <Box sx={{ mt: 1 }}>
                        <TextField
                          label="納品数"
                          size="small"
                          value={it.delivered_qty ?? it.quantity_needed ?? ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            const n = v === '' ? null : Number(v);
                            setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, delivered_qty: n } : x)));
                          }}
                        />
                      </Box>
                    )}
                  </TableCell>

                  {/* 操作 */}
                  <TableCell align="right">
                    {canDelete && (
                      <Button size="small" variant="outlined" onClick={() => removeItem(it)}>
                        削除
                      </Button>
                    )}
                    {!canDelete && <Typography sx={{ opacity: 0.65, fontSize: 12 }}>—</Typography>}
                  </TableCell>
                </TableRow>
              );
            })}

            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} sx={{ opacity: 0.7 }}>
                  明細がありません。
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <Typography sx={{ mt: 2, opacity: 0.7, fontSize: 12 }}>
          ※ 手配/納品のチェック更新は社内（staff/admin）のみ可能です。納品済にすると在庫が自動でマイナスされます（DBトリガー）。
        </Typography>
      </Paper>
    </Box>
  );
}
