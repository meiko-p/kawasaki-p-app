import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Grid, Paper, Typography } from '@mui/material';
import { useAuth } from '../contexts/AuthContext.jsx';

function Card({ title, desc, to, disabled = false }) {
  return (
    <Paper sx={{ p: 2.5, height: '100%', display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="h6" sx={{ fontWeight: 900 }}>
        {title}
      </Typography>
      <Typography sx={{ opacity: 0.75, flex: 1 }}>
        {desc}
      </Typography>
      <Button component={RouterLink} to={to} disabled={disabled} variant="outlined">
        開く
      </Button>
    </Paper>
  );
}

export default function Dashboard() {
  const { role, profile } = useAuth();
  const isStaff = role === 'staff' || role === 'admin';

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 900, mb: 1 }}>
        ダッシュボード
      </Typography>
      <Typography sx={{ opacity: 0.75, mb: 3 }}>
        ようこそ {profile?.display_name || profile?.email || ''}（role: {role || '-'}）
      </Typography>

      <Grid container spacing={2}>

        <Grid item xs={12} md={6} lg={4}>
          <Card
            title="見積＆納品予定＆入札時【スタート】"
            desc="見積計算からPDF出力まで。（社内専用）"
            to="/estimates"
            disabled={!isStaff}
          />
        </Grid>

        <Grid item xs={12} md={6} lg={4}>
          <Card
            title="社内伝票（PDF）"
            desc="手順票・工程表・売上伝票・得意先元帳を作成。入庫確定もここで実行。（社内専用）"
            to="/dempyo"
            disabled={!isStaff}
          />
        </Grid>

                <Grid item xs={12} md={6} lg={4}>
          <Card
            title="梱包登録"
            desc="段ボール写真と三方サイズを登録し、PDF化してダウンロード／メール送信します。"
            to="/packages"
          />
        </Grid>

                <Grid item xs={12} md={6} lg={4}>
          <Card
            title="ラベル【田中さん共有】"
            desc="商品番号と納品数を中央2行で印字し、PDF出力します（社内専用）。"
            to="/labels"
            disabled={!isStaff}
          />
        </Grid>

        <Grid item xs={12} md={6} lg={4}>
          <Card
            title="在庫管理"
            desc="入庫（伝票）と納品（計画）の入出庫を集計して在庫数を表示します（社内専用）。"
            to="/inventory"
            disabled={!isStaff}
          />
        </Grid>


                <Grid item xs={12} md={6} lg={4}>
          <Card
            title="見積＆納品数【確定提出分】"
            desc="最後に川重へ提出"
            to="/products"
          />
        </Grid>

                <Grid item xs={12} md={6} lg={4}>
          <Card
            title="単価登録【ロット単価、商品別単価】"
            desc="単価を各種一覧で登録＆PDF出力。"
            to="/plans"
          />
        </Grid>


                <Grid item xs={12} md={6} lg={4}>
          <Card
            title="商品番号検索"
            desc="商品番号で検索し、各機能（計画・梱包・見積・在庫・ラベル）へ接続します。"
            to="/search"
          />
        </Grid>

      </Grid>
    </Box>
  );
}
