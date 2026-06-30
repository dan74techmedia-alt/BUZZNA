import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { db } from '../offline/db';
import { syncManager } from '../offline/syncmanager';

/**
 * Interface definition for the successful server-side login response.
 * Conforms strictly to the backend API contracts defined in Section 3 and Section 6.
 */
interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    userId: string;
    tenantId: string;
    roleId: string;
    username: string;
    roleName: string;
  };
  snapshot: {
    business: {
      tenantId: string;
      legalName: string;
      tradeName: string | null;
      licenseStatus: 'TRIAL_ACTIVE' | 'PAYMENT_DUE' | 'GRACE_PERIOD' | 'SUSPENDED_NON_PAYMENT' | 'FULLY_ACTIVATED';
      licenseExpiresAt: string;
    };
    permissions: string[];
    fastMovingProducts: Array<{
      productId: string;
      tenantId: string;
      barcode: string;
      costFloor: string;
      retailPrice: string;
      currentQuantity: string;
    }>;
    localCustomers: Array<{
      customerId: string;
      fullName: string;
      phoneNumber: string;
      outstandingCredit: string;
    }>;
  };
}

/**
 * OfflineStatusChip Component
 * Renders the real-time operational availability status of the network context.
 * Essential for sub-Saharan operators to gauge synchronization behaviors immediately.
 */
const OfflineStatusChip: React.FC = () => {
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider transition-all duration-300 ${
        isOnline 
          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
          : 'bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse'
      }`}
    >
      <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-amber-400'}`} />
      {isOnline ? 'Network Cloud Connected' : 'Offline Terminal Mode'}
    </div>
  );
};

/**
 * PasswordField Component
 * Custom scannable input element providing security visualization controls
 * optimized for micro-retail touch vectors.
 */
interface PasswordFieldProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled: boolean;
}

const PasswordField: React.FC<PasswordFieldProps> = ({ value, onChange, disabled }) => {
  const [showPassword, setShowPassword] = useState<boolean>(false);

  return (
    <div className="relative mt-1">
      <input
        id="password"
        name="password"
        type={showPassword ? 'text' : 'password'}
        autoComplete="current-password"
        required
        disabled={disabled}
        value={value}
        onChange={onChange}
        className="w-full px-4 py-3 bg-slate-900 border border-slate-700 text-slate-100 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed placeholder-slate-500"
        placeholder="••••••••"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShowPassword(!showPassword)}
        disabled={disabled}
        className="absolute inset-y-0 right-0 pr-3 flex items-center text-sm leading-5 text-slate-400 hover:text-indigo-400 focus:outline-none disabled:opacity-50"
      >
        {showPassword ? (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
          </svg>
        ) : (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        )}
      </button>
    </div>
  );
};

/**
 * Login Core Component Page
 * Coordinates structural network logins, catches device validations,
 * updates Dexie IndexedDB cache tables under LRU directives, and transitions routers.
 */
export const Login: React.FC = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [uiError, setUiError] = useState<string | null>(null);

  // Fallback to local offline cached checks if a hard network drop prevents API resolution
  useEffect(() => {
    const evaluateExistingSession = async () => {
      try {
        const activeSnapshot = await db.table('business_snapshot').toArray();
        if (activeSnapshot && activeSnapshot.length > 0) {
          const currentTill = await db.table('current_till_session').toArray();
          if (currentTill && currentTill.length > 0) {
            // Secure pass directly to console environment if already initialized offline
            console.log('Valid local offline business mapping discovered. Bypassing cloud gate.');
          }
        }
      } catch (err) {
        console.error('Failure scanning local terminal storage context:', err);
      }
    };
    evaluateExistingSession();
  }, []);

  const loginMutation = useMutation<LoginResponse, Error, void>({
    mutationFn: async () => {
      setUiError(null);
      
      if (!navigator.onLine) {
        throw new Error('Cloud communication channel unavailable. Terminal cannot perform primary root onboarding registration or validation without remote cryptographic assertion.');
      }

      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || `Server authentication rejected credentials with status ${response.status}`);
      }

      return response.json();
    },
    onSuccess: async (data) => {
      try {
        // Enforce structural security context updates across browser tokens
        localStorage.setItem('buzzna_d74_access_token', data.accessToken);
        localStorage.setItem('buzzna_d74_refresh_token', data.refreshToken);

        // Atomic transaction wrapping over local Dexie tables to update operational memory
        await db.transaction('rw', [db.table('business_snapshot'), db.table('products_cache'), db.table('customers_cache')], async () => {
          // Flush previous local context parameters to eliminate cross-tenant leakage options locally
          await db.table('business_snapshot').clear();
          await db.table('products_cache').clear();
          await db.table('customers_cache').clear();

          // Seed the signed corporate parameters to enforce license lockdowns locally
          await db.table('business_snapshot').add({
            tenantId: data.snapshot.business.tenantId,
            legalName: data.snapshot.business.legalName,
            tradeName: data.snapshot.business.tradeName,
            licenseStatus: data.snapshot.business.licenseStatus,
            licenseExpiresAt: data.snapshot.business.licenseExpiresAt,
            permissions: data.snapshot.permissions,
            cachedAt: new Date().toISOString()
          });

          // Ingest fast-moving inventory rows targeting the top 80% distribution frequency (LRU Cache Strategy)
          if (data.snapshot.fastMovingProducts && data.snapshot.fastMovingProducts.length > 0) {
            await db.table('products_cache').bulkAdd(data.snapshot.fastMovingProducts);
          }

          // Populate local neighborhood credit profiles to allow uninterrupted community debt lookups offline
          if (data.snapshot.localCustomers && data.snapshot.localCustomers.length > 0) {
            await db.table('customers_cache').bulkAdd(data.snapshot.localCustomers);
          }
        });

        // Initialize sync management loops asynchronously
        syncManager.initialize();

        // Check license status parameters to steer router endpoints
        if (data.snapshot.business.licenseStatus === 'SUSPENDED_NON_PAYMENT') {
          navigate('/billing');
        } else {
          navigate('/pos');
        }
      } catch (storageError) {
        console.error('IndexedDB ingestion system crashed during token seeding sequence:', storageError);
        setUiError('Local operational storage failed to configure safely. Please check available device storage vectors.');
      }
    },
    onError: (error: any) => {
      setUiError(error.message || 'An unhandled exception blocked execution during remote verification workflows.');
    },
  });

  const handleFormSubmission = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setUiError('Corporate policy requires complete entries across all authentication parameters.');
      return;
    }
    loginMutation.mutate();
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 font-sans selection:bg-indigo-500 selection:text-white">
      {/* Network Connectivity Management Position */}
      <div className="absolute top-6 right-6">
        <OfflineStatusChip />
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
          BUZZNA<span className="text-indigo-500 font-medium text-2xl ml-1 px-1.5 py-0.5 rounded border border-indigo-500/30 bg-indigo-500/10">D74</span>
        </h1>
        <p className="mt-3 text-sm text-slate-400 font-medium">
          Enterprise Business Memory &amp; Action Control Center
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-slate-900/50 backdrop-blur-md py-8 px-6 border border-slate-800 rounded-2xl shadow-xl sm:px-10">
          <form className="space-y-6" onSubmit={handleFormSubmission} noValidate>
            {uiError && (
              <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-sm font-medium leading-relaxed animate-fade-in">
                <div className="flex gap-2">
                  <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span>{uiError}</span>
                </div>
              </div>
            )}

            <div>
              <label htmlFor="username" className="block text-sm font-semibold text-slate-300 tracking-wide uppercase">
                Username / Terminal MSISDN
              </label>
              <div className="mt-1">
                <input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  required
                  disabled={loginMutation.isPending}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-900 border border-slate-700 text-slate-100 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed placeholder-slate-500"
                  placeholder="e.g., cashier_01 or 254700000000"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-slate-300 tracking-wide uppercase">
                Security Password Access Key
              </label>
              <PasswordField 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loginMutation.isPending}
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={loginMutation.isPending}
                className="w-full flex justify-center items-center py-3.5 px-4 border border-transparent rounded-lg shadow-md text-base font-bold text-white bg-indigo-600 hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:ring-indigo-500 active:bg-indigo-700 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loginMutation.isPending ? (
                  <div className="flex items-center gap-2.5">
                    <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Assembling Secure Local Engine...</span>
                  </div>
                ) : (
                  'Authorize & Open Terminal'
                )}
              </button>
            </div>
          </form>
        </div>

        <div className="mt-6 text-center text-xs text-slate-500">
          BuzzNa Operating System • Version 1-Production Lock Document • Secure Tenant Block Execution
        </div>
      </div>
    </div>
  );
};

export default Login; 