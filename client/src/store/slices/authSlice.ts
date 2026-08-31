import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { AuthAPI } from '@/services/authAPI';
import { getErrorMessage } from '@/services/apiClient';
import type { AuthState, LoginRequest, SignupRequest, User } from '@/types/auth';

/**
 * Tokens live in httpOnly cookies, so nothing token-shaped is kept here; the
 * session is established by asking the server who the caller is.
 */
const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
  // Starts true so guarded routes wait for the first check instead of
  // redirecting a signed-in user to the login page on every reload.
  isLoading: true,
  error: null,
};

export const loginUser = createAsyncThunk<User, LoginRequest, { rejectValue: string }>(
  'auth/login',
  async (credentials, { rejectWithValue }) => {
    try {
      const response = await AuthAPI.login(credentials);
      return response.data.user;
    } catch (error) {
      return rejectWithValue(getErrorMessage(error, 'Could not sign in. Check your details and try again.'));
    }
  }
);

export const signupUser = createAsyncThunk<User, SignupRequest, { rejectValue: string }>(
  'auth/signup',
  async (payload, { rejectWithValue }) => {
    try {
      const response = await AuthAPI.signup(payload);
      return response.data.user;
    } catch (error) {
      return rejectWithValue(getErrorMessage(error, 'Could not create the account.'));
    }
  }
);

export const checkAuthentication = createAsyncThunk<User, boolean | undefined, { rejectValue: null }>(
  'auth/check',
  async (isInitialCheck = false, { rejectWithValue }) => {
    try {
      const response = await AuthAPI.checkAuth(isInitialCheck);
      return response.data.user;
    } catch {
      // Not being signed in is an expected outcome, not an error to display.
      return rejectWithValue(null);
    }
  }
);

export const fetchUserProfile = createAsyncThunk<User, void, { rejectValue: string }>(
  'auth/fetchProfile',
  async (_, { rejectWithValue }) => {
    try {
      const response = await AuthAPI.getProfile();
      return response.data.user;
    } catch (error) {
      return rejectWithValue(getErrorMessage(error, 'Could not load your profile'));
    }
  }
);

export const logoutUser = createAsyncThunk<void, void>('auth/logout', async () => {
  try {
    await AuthAPI.logout();
  } catch {
    // The local session is cleared regardless: a failed logout call must not
    // leave the user apparently signed in.
  }
});

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    clearAuth: (state) => {
      state.user = null;
      state.isAuthenticated = false;
      state.isLoading = false;
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loginUser.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(loginUser.fulfilled, (state, action) => {
        state.isLoading = false;
        state.user = action.payload;
        state.isAuthenticated = true;
        state.error = null;
      })
      .addCase(loginUser.rejected, (state, action) => {
        state.isLoading = false;
        state.isAuthenticated = false;
        state.error = action.payload ?? 'Sign in failed';
      })

      .addCase(signupUser.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(signupUser.fulfilled, (state, action) => {
        state.isLoading = false;
        state.user = action.payload;
        state.isAuthenticated = true;
        state.error = null;
      })
      .addCase(signupUser.rejected, (state, action) => {
        state.isLoading = false;
        state.isAuthenticated = false;
        state.error = action.payload ?? 'Registration failed';
      })

      .addCase(checkAuthentication.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(checkAuthentication.fulfilled, (state, action) => {
        state.isLoading = false;
        state.user = action.payload;
        state.isAuthenticated = true;
        state.error = null;
      })
      .addCase(checkAuthentication.rejected, (state) => {
        state.isLoading = false;
        state.user = null;
        state.isAuthenticated = false;
        state.error = null;
      })

      .addCase(fetchUserProfile.fulfilled, (state, action) => {
        state.user = action.payload;
      })

      .addCase(logoutUser.fulfilled, (state) => {
        state.user = null;
        state.isAuthenticated = false;
        state.isLoading = false;
        state.error = null;
      });
  },
});

export const { clearError, clearAuth } = authSlice.actions;

export default authSlice.reducer;
