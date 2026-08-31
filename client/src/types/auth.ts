import type { ApiResponse } from './api';

export interface User {
  id: string;
  fullname: string;
  email: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

/** Login and signup both return the user; tokens are set as httpOnly cookies. */
export type AuthResponse = ApiResponse<{ user: User }>;

export interface LoginRequest {
  email: string;
  password: string;
}

export interface SignupRequest {
  fullname: string;
  email: string;
  password: string;
  confirm_password: string;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}
