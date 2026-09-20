import { ENV } from '@/config/env';
import { getToken as clerkGetToken } from '@clerk/shared/getToken';
import axios, { type InternalAxiosRequestConfig } from 'axios';

export class ApiError extends Error {
  status?: number;
  data?: unknown;

  constructor(message: string, status?: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

type TokenGetter = () => Promise<string | null>;

let tokenGetter: TokenGetter | null = null;

export function setAuthTokenGetter(getter: TokenGetter | null) {
  tokenGetter = getter;
}

export const axiosClient = axios.create({
  baseURL: ENV.apiBaseUrl,
  headers: {
    'Content-Type': 'application/json',
  },
});

axiosClient.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    config.headers.delete('Content-Type');
  }

  try {
    const raw = tokenGetter ? await tokenGetter() : await clerkGetToken();
    const token = String(raw ?? '').replace(/^Bearer\s+/i, '').trim();
    if (token) {
      config.headers.set('Authorization', `Bearer ${token}`);
    }
  } catch {
    // No active Clerk session: leave the request unauthenticated.
  }

  return config;
});

axiosClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const message = error.response?.data?.message ?? error.message ?? 'Request failed';
    return Promise.reject(new ApiError(message, status, error.response?.data));
  },
);
