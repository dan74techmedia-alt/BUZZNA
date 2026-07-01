// apps/web/src/features/auth/authStorage.ts

const TOKEN_KEY = 'buzzna_d74_access_token';
const REFRESH_KEY = 'buzzna_d74_refresh_token';
const TENANT_KEY = 'buzzna_d74_tenant_id';

export const authStorage = {
  getAccessToken: (): string | null => localStorage.getItem(TOKEN_KEY),
  
  getRefreshToken: (): string | null => localStorage.getItem(REFRESH_KEY),
  
  getTenantId: (): string | null => localStorage.getItem(TENANT_KEY),

  setTokens: (accessToken: string, refreshToken: string, tenantId: string): void => {
    localStorage.setItem(TOKEN_KEY, accessToken);
    localStorage.setItem(REFRESH_KEY, refreshToken);
    localStorage.setItem(TENANT_KEY, tenantId);
  },

  clearTokens: (): void => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(TENANT_KEY);
  }
};