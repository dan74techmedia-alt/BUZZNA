import React, { useEffect, useState } from 'react';
import { useSync } from '../../hooks/useSync';
import { RefreshCw, CheckCircle, AlertTriangle, WifiOff } from 'lucide-react';

export default function SyncStatus() {
  const { isSyncing, lastSync, pendingCount, error, forceSync } = useSync();
  const [status, setStatus] = useState<'online' | 'offline' | 'error'>('online');

  useEffect(() => {
    if (error) setStatus('error');
    else if (!navigator.onLine) setStatus('offline');
    else setStatus('online');
  }, [error]);

  return (
    <div className={`flex items-center gap-3 px-4 py-2 rounded-lg border ${
      status === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 
      status === 'offline' ? 'bg-amber-50 border-amber-200 text-amber-700' :
      'bg-green-50 border-green-200 text-green-700'
    }`}>
      {status === 'error' && <AlertTriangle size={18} />}
      {status === 'offline' && <WifiOff size={18} />}
      {status === 'online' && !isSyncing && <CheckCircle size={18} />}
      {isSyncing && <RefreshCw size={18} className="animate-spin" />}

      <div className="flex flex-col">
        <span className="text-xs font-bold uppercase">
          {status === 'error' ? 'Sync Error' : status === 'offline' ? 'Offline Mode' : 'System Synced'}
        </span>
        <span className="text-[10px]">
          {pendingCount > 0 ? `${pendingCount} items pending` : 'All data current'}
        </span>
      </div>

      {pendingCount > 0 && !isSyncing && (
        <button 
          onClick={forceSync}
          className="ml-auto text-xs font-semibold underline hover:text-blue-600"
        >
          Sync Now
        </button>
      )}
    </div>
  );
} 