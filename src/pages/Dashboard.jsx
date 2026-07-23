import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';

import {
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Typography,
} from '@mui/material';

const SHARED_CARDS = {
  orderPlans: {
    title: '計画書（発注）【スタート】',
    description:
      '計画書写真、品番、印刷手配数、納品工場、注文番号、納品予定を登録します。見積数量と在庫管理の起点です。',
    path: '/order-plans',
    start: true,
  },
  packages: {
    title: '梱包登録',
    description:
      '計画書登録済み品番だけを対象に、納入荷姿申請書・写真・梱包サイズ・ロットを登録します。',
    path: '/packages',
  },
  prices: {
    title: '単価登録【数量・商品別単価】',
    description:
      '計画書登録済み品番について、数量と商品別単価を一覧で登録・更新します。',
    path: '/products',
  },
  search: {
    title: '商品番号検索',
    description:
      '計画書登録済みの商品番号から、計画・見積・梱包・ラベル・在庫・単価へ移動します。',
    path: '/search',
  },
};

const STAFF_CARDS = {
  estimates: {
    title: '見積作成',
    description:
      '計画書（発注）の印刷手配数を数量初期値として引き継ぎ、見積計算・PDF出力を行います。',
    path: '/estimates',
  },
  dempyo: {
    title: '社内伝票（PDF）',
    description:
      '手順票・工程表・売上伝票・得意先元帳を作成します。',
    path: '/dempyo',
  },
  labels: {
    title: 'ラベル【田中さん共有】',
    description:
      '計画書登録済み品番の納品予定・ロット・包数を整理し、PDF出力します。',
    path: '/labels',
  },
  inventory: {
    title: '在庫管理（納品完了）',
    description:
      '計画書の印刷手配数から、納品済みにした日別数量を差し引き、現在在庫と完了状態を管理します。',
    path: '/inventory',
  },
  binding: {
    title: '製本スケジュール（3カ月）',
    description:
      '納品日を自動反映し、マットPP・無線綴じ・2回折りの日程を3カ月同時表示で管理します。',
    path: '/binding-schedule',
  },
};

function DashboardCard({ card, onOpen }) {
  return (
    <Paper
      sx={{
        p: 2.5,
        minHeight: 190,
        display: 'flex',
        flexDirection: 'column',
        border: card.start
          ? '1px solid rgba(77, 208, 225, 0.55)'
          : '1px solid rgba(255,255,255,0.08)',
        boxShadow: card.start
          ? '0 0 0 1px rgba(77, 208, 225, 0.12), 0 18px 50px rgba(0,0,0,0.18)'
          : undefined,
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="h6" fontWeight={900} sx={{ flex: 1 }}>
          {card.title}
        </Typography>
        {card.start && <Chip label="START" color="primary" size="small" />}
      </Stack>

      <Typography
        variant="body2"
        sx={{ mt: 1.2, color: 'text.secondary', lineHeight: 1.75, flex: 1 }}
      >
        {card.description}
      </Typography>

      <Button
        variant={card.start ? 'contained' : 'outlined'}
        onClick={() => onOpen(card.path)}
        sx={{ mt: 2 }}
      >
        開く
      </Button>
    </Paper>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { profile, role } = useAuth();

  const isStaff = role === 'staff' || role === 'admin';
  const cards = isStaff
    ? [
        SHARED_CARDS.orderPlans,
        STAFF_CARDS.estimates,
        STAFF_CARDS.dempyo,
        SHARED_CARDS.packages,
        STAFF_CARDS.labels,
        STAFF_CARDS.inventory,
        SHARED_CARDS.prices,
        SHARED_CARDS.search,
        STAFF_CARDS.binding,
      ]
    : [
        SHARED_CARDS.orderPlans,
        SHARED_CARDS.packages,
        SHARED_CARDS.prices,
        SHARED_CARDS.search,
      ];

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h3" fontWeight={900}>
        ダッシュボード
      </Typography>

      <Typography sx={{ mt: 1, color: 'text.secondary' }}>
        ようこそ {profile?.display_name || profile?.email || ''}（role: {role || '-'}）
      </Typography>

      <Paper
        variant="outlined"
        sx={{
          mt: 2.5,
          p: 2,
          borderColor: 'rgba(77, 208, 225, 0.32)',
          bgcolor: 'rgba(77, 208, 225, 0.045)',
        }}
      >
        <Typography fontWeight={900}>現在の業務フロー</Typography>
        <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
          ① 計画書（発注）で品番・印刷手配数・納品予定を登録 → ② 見積へ数量を自動反映 →
          ③ 納品日ごとに「納品済」を登録 → ④ 在庫管理（納品完了）で残数を確認
        </Typography>
      </Paper>

      <Box
        sx={{
          mt: 2.5,
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            md: 'repeat(2, minmax(0, 1fr))',
            xl: 'repeat(3, minmax(0, 1fr))',
          },
          gap: 2,
        }}
      >
        {cards.map((card) => (
          <DashboardCard key={card.path} card={card} onOpen={navigate} />
        ))}
      </Box>
    </Box>
  );
}
