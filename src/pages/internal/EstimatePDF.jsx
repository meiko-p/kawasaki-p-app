import React from 'react';

// ※このパスはプロジェクト配置に合わせて調整してください。
//   Estimates.jsx が src/pages/internal にある前提だと、assets は ../../assets が一般的です。
import meikoLogo from '../../assets/meiko-logo.png';
import meikoHanko from '../../assets/meiko-hanko.png';

const DEFAULT_CLIENT_NAME = '川崎重工業株式会社';

const DELIVERY_FACTORY_OPTIONS = [
  { value: '76', label: '76工場' },
  { value: '85', label: '85工場' },
  { value: '86', label: '86工場' },
];

function factoryLabel(v) {
  return DELIVERY_FACTORY_OPTIONS.find((x) => x.value === v)?.label || (v ? String(v) : '');
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function yen(n) {
  const num = Math.round(toNum(n));
  return `${num.toLocaleString('ja-JP')} 円`;
}

function unitPrice(amount, qty) {
  const a = toNum(amount);
  const q = toNum(qty);
  if (q <= 0) return null;
  return a / q;
}

function formatUnit(n) {
  if (n === null || n === undefined) return '-';
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  return v.toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function normalizeSchedule(v) {
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

function formatDateJP(iso) {
  const s = String(iso || '').trim();
  if (!s) return '';
  // "YYYY-MM-DD" → "YYYY/MM/DD"
  return s.replaceAll('-', '/');
}

function detailAmount(d) {
  // 新→total_estimated_cost（推奨）
  // 旧→total_estimated / total_estimated_cost などが混在しても崩れないようにフォールバック
  const v =
    d?.total_estimated_cost ??
    d?.total_estimated ??
    d?.total_estimated_cost ??
    0;
  return toNum(v);
}

function groupByDetailType(details) {
  const groups = [];
  const map = new Map();

  (details || []).forEach((d) => {
    const key = String(d?.detail_type || '指定無し');
    if (!map.has(key)) {
      const g = { key, items: [] };
      map.set(key, g);
      groups.push(g);
    }
    map.get(key).items.push(d);
  });

  return groups;
}

function colorLabel(d) {
  const c = d?.colors ?? '';
  const side = d?.is_double_sided ? '両面' : '片面';
  if (String(c).trim() === '') return '-';
  return `${c}色（${side}）`;
}

// react-to-print のため forwardRef
const EstimatePDF = React.forwardRef(({ estimate, details }, ref) => {
  const detailList = Array.isArray(details) ? details : [];
  const groups = groupByDetailType(detailList);
  const multiGroup = groups.length >= 2;

  // 合計（税別）
  const groupTotals = groups.map((g) => ({
    key: g.key,
    total: g.items.reduce((sum, d) => sum + detailAmount(d), 0),
  }));
  const grandTotal = groupTotals.reduce((sum, g) => sum + toNum(g.total), 0);

  // ヘッダ情報
  const clientName = DEFAULT_CLIENT_NAME; // 得意先固定運用
  const estimateNo = estimate?.id || '';
  const productCode = estimate?.product?.product_code || estimate?.title || '';
  const productType = estimate?.product?.product_type || '';
  const productName = estimate?.product?.name || '';

  // 追加：納品情報
  const deliveryFactory = estimate?.delivery_factory || '';
  const orderNo = estimate?.kawasaki_order_no || '';
  const schedule = normalizeSchedule(estimate?.delivery_schedule);

  // 納品日の数調整
  const scheduleRows = schedule
    .slice(0, 50)
    .map((r) => ({
      date: r?.date || '',
      qty: r?.qty ?? '',
    }))
    .filter((r) => String(r.date || '').trim() !== '' || String(r.qty ?? '').trim() !== '');

  return (
    <div ref={ref} style={{ width: '740px', padding: '18px 18px 8px', fontFamily: 'sans-serif', color: '#111' }}>
      {/* ヘッダ（ロゴ/印） */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <img
          src={meikoLogo}
          alt="Meiko Logo"
          crossOrigin="anonymous"
          style={{ width: '170px', height: 'auto' }}   // ★ ロゴを大きめに
        />
        <img
          src={meikoHanko}
          alt="Meiko Hanko"
          crossOrigin="anonymous"
          style={{ width: '90px', height: 'auto' }}
        />
      </div>

      <h1 style={{ textAlign: 'center', margin: '18px 0 10px', letterSpacing: '0.3em' }}>
        御 見 積 書
      </h1>

      {/* 見積ヘッダ情報 */}
      <div style={{ marginTop: '10px', lineHeight: 1.7 }}>
        <div>得意先：{clientName} 様</div> {/* ★ 「様」 */}
        <div>見積番号：{estimateNo}</div>
        <div>品番：{productCode}</div>
        <div>商品種類：{productType || '-'}</div>
        <div>商品名：{productName || '-'}</div>
      </div>

      <hr style={{ margin: '16px 0' }} />

      {/* 明細テーブル */}
      <table width="100%" border="1" cellPadding="6" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f0f0f0' }}>
            {/* ★ 指定順：詳細、サイズ、ページ、刷色、製本、数量、単価、金額（税別） */}
            <th style={{ whiteSpace: 'nowrap' }}>詳細</th>
            <th style={{ whiteSpace: 'nowrap' }}>サイズ</th>
            <th style={{ whiteSpace: 'nowrap' }}>ページ</th>
            <th style={{ whiteSpace: 'nowrap' }}>刷色</th>
            <th style={{ whiteSpace: 'nowrap' }}>製本</th>
            <th style={{ whiteSpace: 'nowrap' }}>数量</th>
            <th style={{ whiteSpace: 'nowrap' }}>単価</th>
            <th style={{ whiteSpace: 'nowrap' }}>金額（税別）</th>
          </tr>
        </thead>

        <tbody>
          {detailList.length === 0 ? (
            <tr>
              <td colSpan={8} style={{ textAlign: 'center' }}>
                明細がありません
              </td>
            </tr>
          ) : (
            groups.map((g) => {
              const subtotal = g.items.reduce((sum, d) => sum + detailAmount(d), 0);

              return (
                <React.Fragment key={g.key}>
                  {g.items.map((item) => {
                    const amount = detailAmount(item); // ★ ここが「金額（税別）」に出る値（デザイン＋印刷総額）
                    const unit = unitPrice(amount, item.quantity);

                    return (
                      <tr key={item.id}>
                        <td>{item.detail_type || '-'}</td>
                        <td>{item.size || '-'}</td>
                        <td style={{ textAlign: 'right' }}>{item.pages ? `${item.pages}P` : '-'}</td>
                        <td style={{ textAlign: 'right' }}>{colorLabel(item)}</td>

                        {/* ★ 製本：金額ではなく加工名 */}
                        <td>{String(item.binding_method || '').trim() || '-'}</td>

                        <td style={{ textAlign: 'right' }}>{item.quantity ?? '-'}</td>
                        <td style={{ textAlign: 'right' }}>{formatUnit(unit)}</td>
                        <td style={{ textAlign: 'right' }}>{yen(amount)}</td>
                      </tr>
                    );
                  })}

                  {/* ★ 表紙/本文など、区分が複数ある場合だけ “区分合計” を挿入 */}
                  {multiGroup && (
                    <tr style={{ background: '#fafafa' }}>
                      <td colSpan={7} style={{ textAlign: 'right', fontWeight: 700 }}>
                        {g.key} 合計
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{yen(subtotal)}</td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })
          )}
        </tbody>
      </table>

      {/* 合計表示（税別） */}
      <div style={{ textAlign: 'right', marginTop: '12px' }}>
        <h3 style={{ margin: 0 }}>金額（税別）：{yen(grandTotal)}</h3> {/* ★ 印刷費合計→金額（税別） */}
      </div>

      {/* 納品・注文情報（PDF下部） */}
      <div style={{ marginTop: '18px', display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, marginBottom: '6px' }}>納品・注文情報</div>

          <div style={{ lineHeight: 1.6 }}>
            <div>納品工場：{factoryLabel(deliveryFactory) || '未設定'}</div>
            <div>注文番号：{String(orderNo || '').trim() || '未設定'}</div>
          </div>

          <div style={{ marginTop: '10px', fontWeight: 700 }}>納品予定</div>

          <table width="100%" border="1" cellPadding="6" style={{ borderCollapse: 'collapse', marginTop: '6px' }}>
            <thead>
              <tr style={{ background: '#f7f7f7' }}>
                <th style={{ width: '60%' }}>納品日</th>
                <th style={{ width: '40%' }}>数量</th>
              </tr>
            </thead>
            <tbody>
              {scheduleRows.length === 0 ? (
                <tr>
                  <td colSpan={2} style={{ textAlign: 'center' }}>
                    （未設定）
                  </td>
                </tr>
              ) : (
                scheduleRows.map((r, idx) => (
                  <tr key={idx}>
                    <td>{formatDateJP(r.date) || '-'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {String(r.qty ?? '').trim() === '' ? '-' : `${r.qty}`}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <div style={{ marginTop: '10px' }}>有効期限：発行日より1ヶ月</div>
        </div>

        {/* 会社情報 */}
        <div style={{ width: '280px', textAlign: 'right', lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700 }}>明光印刷株式会社</div>
          <div>〒674-0093 兵庫県明石市二見町南二見17-14</div>
          <div>TEL 078-944-0086</div>
          <div>FAX 078-942-3099</div>
        </div>
      </div>
    </div>
  );
});

export default EstimatePDF;
