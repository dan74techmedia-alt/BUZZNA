import React from 'react';
import { AlertTriangle, Database, Save, Trash2, X } from 'lucide-react';

interface ConflictData {
  id: string;
  entity: string;
  localVersion: any;
  remoteVersion: any;
  conflictType: 'VERSION_MISMATCH' | 'NEGATIVE_INVENTORY';
}

interface ConflictResolutionDialogProps {
  conflict: ConflictData;
  onResolve: (strategy: 'USE_LOCAL' | 'USE_REMOTE' | 'MERGE') => void;
  onClose: () => void;
}

export default function ConflictResolutionDialog({
  conflict,
  onResolve,
  onClose
}: ConflictResolutionDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="bg-amber-50 px-6 py-4 border-b border-amber-100 flex items-center justify-between">
          <div className="flex items-center gap-2 text-amber-800">
            <AlertTriangle size={24} />
            <h2 className="text-lg font-bold">Sync Conflict Detected</h2>
          </div>
          <button onClick={onClose} className="text-amber-800 hover:bg-amber-200 p-1 rounded">
            <X size={20} />
          </button>
        </div>

        <div className="p-6">
          <div className="mb-6">
            <p className="text-sm text-gray-600 mb-4">
              A state collision occurred in the <strong>{conflict.entity}</strong> entity. 
              {conflict.conflictType === 'NEGATIVE_INVENTORY' 
                ? ' The transaction attempts to result in negative stock, violating inventory constraints.' 
                : ' The local record does not match the authoritative server state.'}
            </p>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="border rounded-lg p-4 bg-gray-50">
                <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">Local State</h4>
                <pre className="text-xs font-mono text-gray-800 overflow-x-auto">
                  {JSON.stringify(conflict.localVersion, null, 2)}
                </pre>
              </div>
              <div className="border rounded-lg p-4 bg-blue-50">
                <h4 className="text-xs font-bold text-blue-500 uppercase mb-2">Server (Authoritative)</h4>
                <pre className="text-xs font-mono text-gray-800 overflow-x-auto">
                  {JSON.stringify(conflict.remoteVersion, null, 2)}
                </pre>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button
              onClick={() => onResolve('USE_REMOTE')}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 font-medium"
            >
              <Database size={16} />
              Revert to Server
            </button>
            <button
              onClick={() => onResolve('USE_LOCAL')}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 font-medium"
            >
              <Save size={16} />
              Force Overwrite (Local)
            </button>
            {conflict.conflictType === 'VERSION_MISMATCH' && (
              <button
                onClick={() => onResolve('MERGE')}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
              >
                <Trash2 size={16} />
                Manual Merge
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
} 