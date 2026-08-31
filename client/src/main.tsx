import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { Toaster } from 'sonner';

import App from './App.tsx';
import ErrorBoundary from '@/components/ErrorBoundary';
import ThemeProvider from '@/components/theme/ThemeProvider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { store } from './store';
import { setSessionExpiredHandler } from '@/services/apiClient';
import { clearAuth } from '@/store/slices/authSlice';
import './index.css';

// Let the API client clear auth state when a session cannot be refreshed,
// without importing the store into the client and creating a cycle.
setSessionExpiredHandler(() => {
  store.dispatch(clearAuth());
});

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

createRoot(container).render(
  <ErrorBoundary>
    <Provider store={store}>
      <ThemeProvider>
        <TooltipProvider>
          <BrowserRouter>
            <App />
            <Toaster position="top-right" richColors closeButton />
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </Provider>
  </ErrorBoundary>
);
