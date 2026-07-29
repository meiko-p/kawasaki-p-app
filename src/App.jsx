import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import RequireAuth from './components/RequireAuth.jsx';
import RequireRole from './components/RequireRole.jsx';
import Layout from './components/Layout.jsx';

import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Search from './pages/Search.jsx';

// 社内・川崎重工で共有
import OrderPlans from './pages/shared/OrderPlans.jsx';
import Products from './pages/shared/Products.jsx';
import ProductDetail from './pages/shared/ProductDetail.jsx';
import Packages from './pages/shared/Packages.jsx';

// 社内専用
import Estimates from './pages/internal/Estimates.jsx';
import Dempyo from './pages/internal/Dempyo.jsx';
import Inventory from './pages/internal/Inventory.jsx';
import Labels from './pages/internal/Labels.jsx';
import BindingSchedule from './pages/internal/BindingSchedule.jsx';
import PrintOrderChecklist from './pages/internal/PrintOrderChecklist.jsx';

export default function App() {
  return (
    <Routes>
      {/* 公開ページ */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* ログイン必須 */}
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/search" element={<Search />} />

          {/* 社内 + 川崎重工で共有 */}
          <Route path="/order-plans" element={<OrderPlans />} />
          <Route path="/products" element={<Products />} />
          <Route path="/products/:id" element={<ProductDetail />} />
          <Route path="/packages" element={<Packages />} />

          {/* 社内専用 */}
          <Route element={<RequireRole allowedRoles={['staff', 'admin']} />}>
            <Route path="/estimates" element={<Estimates />} />
            <Route path="/dempyo" element={<Dempyo />} />
            <Route path="/print-order-checklist" element={<PrintOrderChecklist />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/labels" element={<Labels />} />
            <Route path="/binding-schedule" element={<BindingSchedule />} />
          </Route>

          {/* 旧URL互換 */}
          <Route path="/plans" element={<Navigate to="/order-plans" replace />} />
          <Route path="/small-lot" element={<Navigate to="/binding-schedule" replace />} />
          <Route
            path="/emergency-small-lot"
            element={<Navigate to="/binding-schedule" replace />}
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>

      {/* 最終フォールバック */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
