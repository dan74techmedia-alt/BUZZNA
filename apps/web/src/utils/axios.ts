import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { getAuthToken, getTenantId } from '../features/auth/authStorage';

const axiosInstance: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request Interceptor: Inject Auth & Tenant Context
axiosInstance.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = getAuthToken();
    const tenantId = getTenantId();

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    if (tenantId) {
      // Required for RLS isolation on the PostgreSQL backend
      config.headers['x-tenant-id'] = tenantId;
    }

    return config;
  },
  (error: AxiosError) => Promise.reject(error)
);

// Response Interceptor: Handle Global Errors (RBAC, Session Expiry)
axiosInstance.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      // Handle token expiration: Redirect to login or clear store
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }

    if (error.response?.status === 403) {
      // Forbidden: Likely an RLS or RBAC failure
      console.error('Access denied to requested resource.');
    }

    return Promise.reject(error);
  }
);

export default axiosInstance;