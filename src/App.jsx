import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import RequireAuth from './components/RequireAuth.jsx';
import RequireRole from './components/RequireRole.jsx';
import Layout from './components/Layout.jsx';

import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Search from './pages/Search.jsx';

// 共有
import OrderPlans from './pages/shared/OrderPlans.jsx';
import Products from './pages/shared/Products.jsx';
import ProductDetail from './pages/shared/ProductDetail.jsx';
import Plans from './pages/shared/Plans.jsx';
import Packages from './pages/shared/Packages.jsx';

// 社内
import Estimates from './pages/internal/Estimates.jsx';
import Dempyo from './pages/internal/Dempyo.jsx';
import Inventory from './pages/internal/Inventory.jsx';
import Labels from './pages/internal/Labels.jsx';
import BindingSchedule from './pages/internal/BindingSchedule.jsx';

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* Login required */}
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/search" element={<Search />} />

          {/* 社内 + 川崎重工で共有 */}
          <Route path="/order-plans" element={<OrderPlans />} />
          <Route path="/products" element={<Products />} />
          <Route path="/products/:id" element={<ProductDetail />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/packages" element={<Packages />} />

          {/* 社内専用 */}
          <Route element={<RequireRole allowedRoles={['staff', 'admin']} />}>
            <Route path="/estimates" element={<Estimates />} />
            <Route path="/dempyo" element={<Dempyo />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/labels" element={<Labels />} />
            <Route path="/binding-schedule" element={<BindingSchedule />} />
          </Route>

          {/* 旧URL互換：緊急時小ロット対応は製本スケジュールへ */}
          <Route
            path="/small-lot"
            element={<Navigate to="/binding-schedule" replace />}
          />
          <Route
            path="/emergency-small-lot"
            element={<Navigate to="/binding-schedule" replace />}
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>

      {/* fallback */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
