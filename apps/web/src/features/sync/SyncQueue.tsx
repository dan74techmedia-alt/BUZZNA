import React from 'react';
import { useSync } from '../../hooks/useSync';
import { RefreshCw, XCircle, CheckCircle, Clock, Database, Trash2 } from 'lucide-react';

export default function SyncQueue() {
  const { queue, isSyncing, retryItem, removeItem, clearFailed } = useSync();

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'PENDING': return <Clock className="text-gray-400" size={16} />;
      case 'SYNCED': return <CheckCircle className="text-green-500" size={16} />;
      case 'FAILED': return <XCircle className="text-red-500" size={16} />;
      default: return <Database size={16} />;
    }
  };

  return (
    <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden flex flex-col h-full">
      <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
        <h3 className="font-bold text-gray-800 flex items-center gap-2">
          <Database size={18} />
          Outbound Sync Queue
        </h3>
        <div className="flex gap-2">
          <button
            onClick={clearFailed}
            className="text-xs text-red-600 hover:text-red-800 font-semibold flex items-center gap-1"
          >
            <Trash2 size={14} /> Clear Failed
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 p-8 text-center">
            <CheckCircle size={48} className="mb-2 opacity-50" />
            <p className="text-sm">Queue is empty. All operations synchronized.</p>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Status</th>
                <th className="px-4 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Action</th>
                <th className="px-4 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Timestamp</th>
                <th className="px-4 py-2 text-right text-[10px] font-bold text-gray-500 uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {queue.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(item.status)}
                      <span className="text-xs font-medium text-gray-700">{item.status}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 font-mono">
                    {item.endpoint}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {new Date(item.created_at).toLocaleTimeString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {item.status === 'FAILED' && (
                      <button
                        onClick={() => retryItem(item.id)}
                        className="text-blue-600 hover:text-blue-800 p-1 rounded hover:bg-blue-50"
                        title="Retry Sync"
                      >
                        <RefreshCw size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="p-3 bg-gray-50 border-t border-gray-200 text-right">
        <span className="text-[10px] text-gray-400 font-bold uppercase">
          {isSyncing ? 'Synchronization in progress...' : 'Idle'}
        </span>
      </div>
    </div> 
  );
}