import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import AuthInitializer from '@/components/AuthInitializer';
import ProtectedRoute from '@/components/ProtectedRoute';
import Index from '@/pages/Index';

// The playground pulls in the data grid, chart rendering and the export
// pipeline; loading it lazily keeps the landing page bundle small.
const PlayGround = lazy(() => import('@/pages/PlayGround'));
const Auth = lazy(() => import('@/pages/Auth'));
const Dashboards = lazy(() => import('@/pages/Dashboards'));
const SharedDashboard = lazy(() => import('@/pages/SharedDashboard'));
const NotFound = lazy(() => import('@/pages/NotFound'));

const RouteFallback = () => (
  <div className="flex min-h-dvh items-center justify-center">
    <Loader2 className="text-primary h-6 w-6 animate-spin" />
  </div>
);

const App = () => (
  <AuthInitializer>
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route
          path="/auth"
          element={
            <ProtectedRoute requireAuth={false}>
              <Auth />
            </ProtectedRoute>
          }
        />
        <Route
          path="/playground"
          element={
            <ProtectedRoute>
              <PlayGround />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboards"
          element={
            <ProtectedRoute>
              <Dashboards />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboards/:id"
          element={
            <ProtectedRoute>
              <Dashboards />
            </ProtectedRoute>
          }
        />
        {/* Deliberately public: the token in the URL is the capability, so a
            recipient without an account can open a shared dashboard. */}
        <Route path="/shared/:token" element={<SharedDashboard />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  </AuthInitializer>
);

export default App;
