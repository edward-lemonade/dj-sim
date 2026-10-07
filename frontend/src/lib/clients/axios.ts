import { ENV } from '@/config/env';
import { getToken as clerkGetToken } from '@clerk/shared/getToken';
import axios, { type InternalAxiosRequestConfig } from 'axios';
import { API_REQUEST_SLOW_EVENT } from '@/lib/apiEvents';

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
const requestTimers = new WeakMap<InternalAxiosRequestConfig, number>();

export function setAuthTokenGetter(getter: TokenGetter | null) {
  tokenGetter = getter;
}

function clearRequestTimer(config?: InternalAxiosRequestConfig) {
  if (!config) return;
  const timer = requestTimers.get(config);
  if (timer === undefined) return;
  window.clearTimeout(timer);
  requestTimers.delete(config);
}

export const axiosClient = axios.create({
  baseURL: ENV.apiBaseUrl,
  headers: {
    'Content-Type': 'application/json',
  },
});

axiosClient.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const timer = window.setTimeout(() => {
    window.dispatchEvent(new Event(API_REQUEST_SLOW_EVENT));
  }, 3000);
  requestTimers.set(config, timer);

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
  (response) => {
    clearRequestTimer(response.config);
    return response;
  },
  (error) => {
    if (axios.isAxiosError(error)) {
      clearRequestTimer(error.config);
    }
    const status = error.response?.status;
    const message = error.response?.data?.message ?? error.message ?? 'Request failed';
    return Promise.reject(new ApiError(message, status, error.response?.data));
  },
);
