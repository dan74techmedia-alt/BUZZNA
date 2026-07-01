// apps/web/src/layouts/PosLayout.tsx
import React, { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth.store';
import { OfflineIndicator } from '../components/OfflineIndicator';

export const PosLayout: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  // Architecture Rule 4.4: Shift Accountability - Ensure terminal binds to active till session
  useEffect(() => {
    const checkActiveTill = async () => {
      // In reality, this checks IndexedDB current_till_session or fetches from API
      const hasActiveSession = true; 
      if (!hasActiveSession) {
        navigate('/till/open');
      }
    };
    checkActiveTill();
  }, [navigate]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-100 font-sans">
      {/* Topbar: Minimal Point of Sale header */}
      <header className="flex items-center justify-between px-6 py-3 bg-slate-900 text-white shadow-md z-10">
        <div className="flex items-center space-x-4">
          <h1 className="text-xl font-black tracking-tight text-yellow-400">BuzzNa D74</h1>
          <span className="bg-slate-700 px-3 py-1 rounded-full text-xs font-semibold">
            POS Terminal Active
          </span>
        </div>
        
        <div className="flex items-center space-x-6">
          <div className="text-right">
            <p className="text-sm font-bold">{user?.full_name}</p>
            <p className="text-xs text-slate-400">Cashier Role</p>
          </div>
          <button 
            onClick={() => navigate('/dashboard')}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded text-sm font-medium transition-colors"
          >
            Exit POS
          </button>
        </div>
      </header>

      {/* Main POS Content (Cart, Barcode Scanner, Products Map) */}
      <main className="flex-1 overflow-hidden relative">
        <Outlet />
      </main>

      <OfflineIndicator />
    </div>
  );
};