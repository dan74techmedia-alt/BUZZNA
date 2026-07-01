// apps/web/src/components/ProtectedRoute.tsx
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/auth.store';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: string[];
  requiresPosWrite?: boolean;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ 
  children, 
  allowedRoles,
  requiresPosWrite = false
}) => {
  const { isAuthenticated, user, licenseStatus } = useAuthStore();
  const location = useLocation();

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // RBAC Matrix Enforcement
  if (allowedRoles && !allowedRoles.includes(user.role_name)) {
    return <Navigate to="/unauthorized" replace />;
  }

  // Architecture Rule 7.3: License Enforcement & Lockdown
  if (requiresPosWrite) {
    if (licenseStatus === 'SUSPENDED_NON_PAYMENT') {
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-slate-50 p-6 text-center">
          <div className="bg-red-100 text-red-800 p-6 rounded-lg max-w-md border border-red-300">
            <h2 className="text-xl font-bold mb-2">Account Suspended</h2>
            <p className="text-sm mb-4">
              Your POS execution rights have been locked due to non-payment. Analytics and historical records remain in read-only mode.
            </p>
            <button 
              onClick={() => window.location.href = '/billing'}
              className="px-4 py-2 bg-red-600 text-white rounded shadow font-semibold hover:bg-red-700"
            >
              Go to Billing Console
            </button>
          </div>
        </div>
      );
    }
  }

  return <>{children}</>;
}; 