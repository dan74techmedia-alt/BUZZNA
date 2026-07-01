// apps/web/src/components/OfflineIndicator.tsx
import React, { useEffect, useState } from 'react';
import { useOffline } from '../hooks/useOffline';
import { useSync } from '../hooks/useSync';

export const OfflineIndicator: React.FC = () => {
  const isOffline = useOffline();
  const { pendingSyncCount, isSyncing, syncNow } = useSync();
  const [showDetails, setShowDetails] = useState(false);

  if (!isOffline && pendingSyncCount === 0) return null;

  return (
    <div 
      className={`fixed bottom-4 right-4 z-50 flex items-center p-3 rounded-full shadow-lg cursor-pointer transition-colors ${
        isOffline ? 'bg-red-600 text-white' : 'bg-yellow-500 text-slate-900'
      }`}
      onClick={() => setShowDetails(!showDetails)}
      title="System Connection Status"
    >
      <div className="flex items-center space-x-2">
        <span className="relative flex h-3 w-3">
          {isSyncing && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
          )}
          <span className={`relative inline-flex rounded-full h-3 w-3 ${isOffline ? 'bg-red-300' : 'bg-white'}`}></span>
        </span>
        <span className="font-semibold text-sm">
          {isOffline ? 'Offline Mode' : 'Syncing Local Data...'}
        </span>
      </div>

      {showDetails && (
        <div className="absolute bottom-14 right-0 w-64 bg-white text-slate-800 p-4 rounded-lg shadow-xl border border-slate-200">
          <h4 className="font-bold text-sm mb-2 border-b pb-1">Dexie Sync Queue</h4>
          <p className="text-xs mb-1">Status: {isOffline ? 'Disconnected' : 'Connected'}</p>
          <p className="text-xs mb-3">Pending Offline Actions: <strong>{pendingSyncCount}</strong></p>
          
          {!isOffline && pendingSyncCount > 0 && (
            <button 
              onClick={(e) => { e.stopPropagation(); syncNow(); }}
              disabled={isSyncing}
              className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-xs font-bold rounded"
            >
              {isSyncing ? 'Pushing Packets...' : 'Force Sync Now'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}; 