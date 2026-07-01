import React from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { PosLayout } from './layouts/PosLayout';

// Pages
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import PosConsole from './pages/PosConsole';
import Inventory from './pages/Inventory';
import Customers from './pages/Customers';
import Expenses from './pages/Expenses';
import Billing from './pages/Billing';
import TillManagement from './pages/TillManagement';
import MerchantPayments from './pages/MerchantPayments';

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <Login />,
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <PosLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'pos', element: <PosConsole /> },
      { path: 'inventory', element: <Inventory /> },
      { path: 'customers', element: <Customers /> },
      { path: 'expenses', element: <Expenses /> },
      { path: 'till', element: <TillManagement /> },
      { path: 'merchant-payments', element: <MerchantPayments /> },
      { path: 'billing', element: <Billing /> },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
]);