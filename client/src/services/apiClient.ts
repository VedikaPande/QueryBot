import axios, { AxiosError, type AxiosInstance } from 'axios';
import { config } from '@/config/env';
import { csrfHeaders } from './csrf';
import type { ApiError } from '@/types/api';

/**
 * Shared axios instances.
 *
 * `api` transparently refreshes an expired access token once and replays the
 * request. `plainApi` skips that interceptor and is used by the auth endpoints
 * themselves, which must not trigger a refresh cycle.
 */
const createInstance = (): AxiosInstance =>
  axios.create({
    baseURL: config.API_BASE_URL,
    headers: { 'Content-Type': 'application/json' },
    // Required for the httpOnly JWT cookies the server sets.
    withCredentials: true,
  });

export const api = createInstance();
export const plainApi = createInstance();

/**
 * Attach the CSRF token to mutating requests.
 *
 * Production enables cookie CSRF protection, so without this every POST, PATCH
 * and DELETE is rejected with "Missing CSRF token" — a failure that does not
 * appear in development, where the protection is off.
 */
const attachCsrf = (instance: AxiosInstance): void => {
  instance.interceptors.request.use((request) => {
    Object.assign(request.headers, csrfHeaders(request.method, request.url));
    return request;
  });
};

attachCsrf(api);
attachCsrf(plainApi);

/** Endpoints that must never trigger a token refresh. */
const AUTH_PATHS = ['/auth/refresh', '/auth/login', '/auth/signup'];

/**
 * In-flight refresh, shared by every request that 401s concurrently, so a burst
 * of them waits on one refresh instead of firing several.
 */
let refreshInFlight: Promise<void> | null = null;

const refreshSession = (): Promise<void> => {
  refreshInFlight ??= plainApi
    .post('/auth/refresh')
    .then(() => undefined)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
};

/** Called when the session cannot be recovered, so the app can clear its state. */
type SessionExpiredHandler = () => void;
let onSessionExpired: SessionExpiredHandler | null = null;

export const setSessionExpiredHandler = (handler: SessionExpiredHandler): void => {
  onSessionExpired = handler;
};

interface RetriableConfig {
  _retry?: boolean;
  url?: string;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (typeof error.config & RetriableConfig) | undefined;

    const isAuthPath = AUTH_PATHS.some((path) => original?.url?.includes(path));
    const shouldRefresh =
      error.response?.status === 401 && original && !original._retry && !isAuthPath;

    if (!shouldRefresh) {
      return Promise.reject(error);
    }

    original._retry = true;

    try {
      await refreshSession();
      return await api(original);
    } catch {
      // The refresh token is gone or expired: the session is over. Redirection
      // is left to the app so it can preserve the current location.
      onSessionExpired?.();
      return Promise.reject(error);
    }
  }
);

/** Extract a message suitable for showing the user from any thrown value. */
export const getErrorMessage = (error: unknown, fallback = 'Something went wrong'): string => {
  if (axios.isAxiosError<ApiError>(error)) {
    if (!error.response) {
      return 'Could not reach the server. Check that it is running and try again.';
    }

    const data = error.response.data;

    // Field-level validation errors are more useful than the generic message.
    if (data?.errors) {
      const details = Object.entries(data.errors)
        .map(([field, messages]) => `${field}: ${messages.join(', ')}`)
        .join('\n');
      if (details) return details;
    }

    return data?.message || fallback;
  }

  return error instanceof Error ? error.message : fallback;
};
