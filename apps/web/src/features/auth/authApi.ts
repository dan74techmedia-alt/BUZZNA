// apps/web/src/features/auth/authApi.ts
//
// Shared authenticated Axios instance. Requests are proxied through Vite's
// dev server (`/api` -> API server) and automatically carry the bearer token
// and tenant context injected by the interceptors in utils/axios.
import axiosInstance from '../../utils/axios';

export const authApi = axiosInstance;
export default axiosInstance;
