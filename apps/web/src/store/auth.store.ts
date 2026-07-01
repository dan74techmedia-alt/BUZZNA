// apps/web/src/store/auth.store.ts
import { create } from 'zustand';
import { authStorage } from '../features/auth/authStorage';

export type LicenseStatus = 'TRIAL_ACTIVE' | 'PAYMENT_DUE' | 'GRACE_PERIOD' | 'SUSPENDED_NON_PAYMENT' | 'FULLY_ACTIVATED';

interface UserProfile {
  user_id: string;
  tenant_id: string;
  username: string;
  full_name: string;
  role_id: string;
  role_name: string; // Hydrated from Roles table relation
}

interface AuthState {
  isAuthenticated: boolean;
  user: UserProfile | null;
  licenseStatus: LicenseStatus | null;
  tenantId: string | null;
  
  login: (user: UserProfile, licenseStatus: LicenseStatus, accessToken: string, refreshToken: string) => void;
  updateLicenseStatus: (status: LicenseStatus) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: !!authStorage.getAccessToken(),
  user: null, // Should be hydrated on app load via /api/v1/business/me
  licenseStatus: null,
  tenantId: authStorage.getTenantId(),

  login: (user, licenseStatus, accessToken, refreshToken) => {
    authStorage.setTokens(accessToken, refreshToken, user.tenant_id);
    set({
      isAuthenticated: true,
      user,
      licenseStatus,
      tenantId: user.tenant_id
    });
  },

  updateLicenseStatus: (status) => set({ licenseStatus: status }),

  logout: () => {
    authStorage.clearTokens();
    // System Architecture Rule: Clear offline LRU caches on logout to prevent data leakage between tenants
    indexedDB.deleteDatabase('BuzzNaOfflineDB'); 
    set({
      isAuthenticated: false,
      user: null,
      licenseStatus: null,
      tenantId: null
    });
  }
}));