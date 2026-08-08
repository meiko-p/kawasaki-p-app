import React, { forwardRef, useMemo } from 'react';
import meikoLogo from '../../assets/meiko-logo.png';

const FIXED_RECIPIENT_LINES = [
  'カワサキモータース株式会社',
  '調達統括部　調達管理部',
  '調達管理課　御中',
];

const PRODUCT_TYPE_LABELS = {
  ENGINE: '小型エンジン',
  OM: 'O/M',
  OTHER: 'その他',
};

function productTypeLabel(value) {
  return PRODUCT_TYPE_LABELS[value] || String(value || '');
}

function toNumber(value) {
  const normalized = String(value ?? '')
    .replace(/[０-９]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0xfee0),
    )
    .replace(/[，,]/g, '')
    .match(/-?\d+(?:\.\d+)?/);

  if (!normalized) return 0;
  const number = Number(normalized[0]);
  return Number.isFinite(number) ? number : 0;
}

function formatMoney(value) {
  return Math.round(toNumber(value)).toLocaleString('ja-JP');
}

function formatUnitPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0.00';
  return number.toLocaleString('ja-JP', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatReiwaDate(date = new Date()) {
  const year = date.getFullYear();
  const reiwaYear = Math.max(1, year - 2018);
  return `令和${String(reiwaYear).padStart(2, '0')}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function factoryNumber(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  return digits ? String(Number(digits)) : '';
}

function detailAmount(detail) {
  return toNumber(
    detail?.total_estimated_cost ??
      detail?.total_estimated ??
      detail?.print_total_cost ??
      0,
  );
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
  if (list.length === 0) return '';

  const cover = firstDetailByType(list, ['表紙']);
  const body = firstDetailByType(list, ['本文']);
  const combined = firstDetailByType(list, ['表紙＋本文', '指定無し']);
  const representative = cover || body || combined || list[0];

  const parts = [];
  if (representative?.size) parts.push(String(representative.size));

  if (cover) {
    const coverColor = colorSlash(cover);
    parts.push(`表紙${coverColor || '-'}`);
  }

  if (body) {
    const bodyPages = toNumber(body.pages);
    const bodyColor = colorSlash(body);
    parts.push(
      `本文${bodyPages > 0 ? `${Math.round(bodyPages)}P` : ''}${
        bodyColor ? ` ${bodyColor}` : ''
      }`,
    );
  }

  if (!cover && !body && combined) {
    const pages = toNumber(combined.pages);
    const colors = colorSlash(combined);
    if (pages > 0) parts.push(`${Math.round(pages)}P`);
    if (colors) parts.push(colors);
  }

  const bodyBinding = String(body?.binding_method || '').trim();
  if (bodyBinding && bodyBinding.includes('無線綴じ')) {
    parts.push('無線綴じ');
  } else if (!body) {
    const fallbackBinding = String(representative?.binding_method || '').trim();
    if (fallbackBinding) parts.push(fallbackBinding);
  }

  return parts.filter(Boolean).join('　');
}

function buildApplicationLines(estimate, details) {
  const product = estimate?.product || {};
  const type = productTypeLabel(product.product_type);
  const productName = String(product.name || '').trim();
  const productCode = String(product.product_code || estimate?.title || '').trim();
  const factory = factoryNumber(estimate?.delivery_factory);
  const quoteQuantity = Math.max(0, Math.round(toNumber(estimate?.quote_quantity)));
  const specification = buildSpecification(details);
  const note = String(estimate?.quote_note || '').trim();

  return [
    [type, productName, productCode].filter(Boolean).join('　'),
    `${factory ? `#${factory}` : '#--'}　${quoteQuantity.toLocaleString(
      'ja-JP',
    )}部　（登録単価見積書）`,
    specification,
    note,
  ].filter((line) => String(line || '').trim() !== '');
}

const EstimatePDF = forwardRef(function EstimatePDF({ estimate, details }, ref) {
  const detailList = Array.isArray(details) ? details : [];

  const totalAmount = useMemo(
    () => detailList.reduce((sum, detail) => sum + detailAmount(detail), 0),
    [detailList],
  );

  const quoteQuantity = Math.max(0, Math.round(toNumber(estimate?.quote_quantity)));
  const unitPrice = quoteQuantity > 0 ? totalAmount / quoteQuantity : 0;
  const applicationLines = buildApplicationLines(estimate, detailList);
  const blankRows = Array.from({ length: 4 }, (_, index) => index);

  return (
    <div
      ref={ref}
      style={{
        width: '210mm',
        minHeight: '297mm',
        padding: '14mm 13mm 12mm',
        boxSizing: 'border-box',
        background: '#ffffff',
        color: '#111111',
        fontFamily:
          '"Yu Gothic", "YuGothic", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif',
        fontSize: '10.5pt',
      }}
    >
      <div
        style={{
          textAlign: 'center',
          fontSize: '18pt',
          fontWeight: 700,
          letterSpacing: '0.42em',
          textDecoration: 'underline',
          textUnderlineOffset: '4px',
          marginBottom: '8mm',
        }}
      >
        御 見 積 書
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1.05fr',
          columnGap: '16mm',
          alignItems: 'start',
        }}
      >
        <div>
          <div style={{ fontWeight: 700, lineHeight: 1.55 }}>
            {FIXED_RECIPIENT_LINES.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>

          <div
            style={{
              marginTop: '2.5mm',
              paddingBottom: '1.8mm',
              borderBottom: '1px solid #222',
              fontSize: '8.6pt',
            }}
          >
            下記の通り御見積り申し上げます。
          </div>

          <div style={{ marginTop: '5mm' }}>
            {[
              ['受渡期日', 'ご指定日'],
              ['受渡場所', 'ご指定場所'],
              ['取引条件', '従来通り'],
              ['有効期限', '発行日より1ヶ月'],
            ].map(([label, value]) => (
              <div
                key={label}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '27mm 1fr',
                  minHeight: '8mm',
                  alignItems: 'end',
                  borderBottom: '1px solid #222',
                  fontSize: '9pt',
                }}
              >
                <span>{label}</span>
                <span>{value}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div style={{ textAlign: 'right', fontSize: '9pt', marginBottom: '5mm' }}>
            {formatReiwaDate(new Date())}
          </div>

          <div style={{ textAlign: 'center' }}>
            <img
              src={meikoLogo}
              alt="明光印刷株式会社"
              crossOrigin="anonymous"
              style={{ width: '66mm', maxHeight: '29mm', objectFit: 'contain' }}
            />
          </div>
        </div>
      </div>

      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          marginTop: '7mm',
          tableLayout: 'fixed',
          fontSize: '9pt',
        }}
      >
        <colgroup>
          <col style={{ width: '54%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '17%' }} />
        </colgroup>
        <thead>
          <tr>
            {['適用', '数量', '単価', '金額'].map((label) => (
              <th
                key={label}
                style={{
                  border: '1px solid #222',
                  padding: '2.2mm 1.5mm',
                  textAlign: 'center',
                  fontWeight: 700,
                }}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr style={{ height: '34mm' }}>
            <td
              style={{
                border: '1px solid #222',
                padding: '2.5mm 2mm',
                verticalAlign: 'top',
                lineHeight: 1.72,
                whiteSpace: 'pre-wrap',
              }}
            >
              {applicationLines.map((line, index) => (
                <div key={`${line}-${index}`}>{line}</div>
              ))}
            </td>
            <td
              style={{
                border: '1px solid #222',
                padding: '2mm',
                textAlign: 'right',
                verticalAlign: 'middle',
              }}
            >
              {quoteQuantity.toLocaleString('ja-JP')}
            </td>
            <td
              style={{
                border: '1px solid #222',
                padding: '2mm',
                textAlign: 'right',
                verticalAlign: 'middle',
              }}
            >
              {formatUnitPrice(unitPrice)}
            </td>
            <td
              style={{
                border: '1px solid #222',
                padding: '2mm',
                textAlign: 'right',
                verticalAlign: 'middle',
              }}
            >
              {formatMoney(totalAmount)}
            </td>
          </tr>

          {blankRows.map((row) => (
            <tr key={row} style={{ height: '9mm' }}>
              <td style={{ border: '1px dotted #555' }} />
              <td style={{ border: '1px dotted #555' }} />
              <td style={{ border: '1px dotted #555' }} />
              <td style={{ border: '1px dotted #555' }} />
            </tr>
          ))}

          <tr style={{ height: '10mm' }}>
            <td style={{ border: '1px solid #222' }} />
            <td style={{ border: '1px solid #222' }} />
            <td
              style={{
                border: '1px solid #222',
                padding: '2mm 1mm',
                textAlign: 'center',
                whiteSpace: 'nowrap',
              }}
            >
              ＜消費税別途＞
            </td>
            <td
              style={{
                border: '1px solid #222',
                padding: '2mm',
                textAlign: 'right',
                fontWeight: 700,
                fontSize: '10pt',
              }}
            >
              ¥{formatMoney(totalAmount)}
            </td>
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: '4mm', fontSize: '8pt', color: '#333' }}>
        見積番号：{estimate?.id || '-'}
      </div>
    </div>
  );
});

export default EstimatePDF;
