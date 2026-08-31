import { api, plainApi } from './apiClient';
import type { ApiResponse } from '@/types/api';
import type { AuthResponse, LoginRequest, SignupRequest, User } from '@/types/auth';

type UserPayload = ApiResponse<{ user: User }>;

/**
 * Authentication endpoints.
 *
 * Tokens live in httpOnly cookies set by the server, so nothing here reads or
 * stores a token; the browser attaches them automatically.
 */
export const AuthAPI = {
  async login(credentials: LoginRequest): Promise<AuthResponse> {
    const { data } = await plainApi.post<AuthResponse>('/auth/login', credentials);
    return data;
  },

  async signup(payload: SignupRequest): Promise<AuthResponse> {
    const { data } = await plainApi.post<AuthResponse>('/auth/signup', payload);
    return data;
  },

  async getProfile(): Promise<UserPayload> {
    const { data } = await api.get<UserPayload>('/auth/profile');
    return data;
  },

  /**
   * Verify the session.
   *
   * `initial` uses the plain instance during app start-up: a 401 there is the
   * expected "not signed in" case, and routing it through the refresh
   * interceptor would fire a pointless request on every anonymous page load.
   */
  async checkAuth(initial = false): Promise<UserPayload> {
    const client = initial ? plainApi : api;
    const { data } = await client.get<UserPayload>('/auth/check');
    return data;
  },

  async logout(): Promise<void> {
    await api.post('/auth/logout');
  },
};

export default AuthAPI;
