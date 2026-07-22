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

const SHARED_CARDS = [
  {
    title: '計画書（発注）【スタート】',
    description:
      '計画書写真、品番、商品種類、商品名、納品工場、注文番号、納品予定を登録します。すべての業務の起点です。',
    path: '/order-plans',
    start: true,
  },
  {
    title: '梱包登録',
    description:
      '計画書登録済み品番だけを対象に、納入荷姿申請書・写真・梱包サイズ・ロットを登録します。',
    path: '/packages',
  },
  {
    title: '見積＆納品数【確定提出分】',
    description:
      '確定した見積数量と納品数を川崎重工側と共有・確認します。',
    path: '/plans',
  },
  {
    title: '単価登録【ロット単価・商品別単価】',
    description:
      '計画書登録済み品番の単価を一覧で登録・更新します。',
    path: '/products',
  },
  {
    title: '商品番号検索',
    description:
      '計画書登録済みの商品番号から、計画・見積・梱包・ラベル・在庫・単価へ移動します。',
    path: '/search',
  },
];

const STAFF_CARDS = [
  {
    title: '見積作成',
    description:
      '計画書（発注）に登録済みの品番を検索し、見積計算・PDF出力を行います。',
    path: '/estimates',
  },
  {
    title: '社内伝票（PDF）',
    description:
      '手順票・工程表・売上伝票・得意先元帳を作成します。入庫確定もここで行います。',
    path: '/dempyo',
  },
  {
    title: 'ラベル【田中さん共有】',
    description:
      '計画書登録済み品番の納品予定・ロット・包数を整理し、PDF出力します。',
    path: '/labels',
  },
  {
    title: '在庫管理',
    description:
      '見積総数から納品計画を差し引き、在庫数・棚番号・完了状態を管理します。',
    path: '/inventory',
  },
  {
    title: '製本スケジュール（3カ月）',
    description:
      '納品日を自動反映し、マットPP・無線綴じ・2回折りの日程を3カ月同時表示で管理します。',
    path: '/binding-schedule',
  },
];

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
    ? [SHARED_CARDS[0], STAFF_CARDS[0], STAFF_CARDS[1], SHARED_CARDS[1], STAFF_CARDS[2], STAFF_CARDS[3], SHARED_CARDS[2], SHARED_CARDS[3], SHARED_CARDS[4], STAFF_CARDS[4]]
    : SHARED_CARDS;

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
        <Typography fontWeight={900}>新しい業務の流れ</Typography>
        <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
          ① 計画書（発注）で品番・納品情報を登録 → ② 見積 → ③ 社内伝票・梱包・ラベル・在庫・単価 → ④ 製本スケジュールへ自動連携
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
