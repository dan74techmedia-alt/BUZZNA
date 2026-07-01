import axiosInstance from './axios';
import { AxiosResponse } from 'axios';

/**
 * Centralized API client wrapper.
 * Ensures all outgoing requests are injected with the required
 * tenant-context headers and authorization tokens.
 */
export const api = {
  get: <T>(url: string, params?: object): Promise<AxiosResponse<T>> => {
    return axiosInstance.get(url, { params });
  },

  post: <T>(url: string, data?: object): Promise<AxiosResponse<T>> => {
    return axiosInstance.post(url, data);
  },

  put: <T>(url: string, data?: object): Promise<AxiosResponse<T>> => {
    return axiosInstance.put(url, data);
  },

  patch: <T>(url: string, data?: object): Promise<AxiosResponse<T>> => {
    return axiosInstance.patch(url, data);
  },

  delete: <T>(url: string): Promise<AxiosResponse<T>> => {
    return axiosInstance.delete(url);
  },

  // Helper for multi-tenant authenticated requests
  request: <T>(config: any): Promise<AxiosResponse<T>> => {
    return axiosInstance(config);
  }
}; 