import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAppSelector } from '@/hooks/redux';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAuth?: boolean;
}

/**
 * Route guard.
 *
 * Waits for the initial session check before deciding: redirecting while the
 * check is still in flight bounced signed-in users to the login page on every
 * hard reload.
 */
const ProtectedRoute = ({ children, requireAuth = true }: ProtectedRouteProps) => {
  const { isAuthenticated, isLoading } = useAppSelector((state) => state.auth);
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (requireAuth && !isAuthenticated) {
    // Remember where they were headed so sign-in can return them there.
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  if (!requireAuth && isAuthenticated) {
    const from = (location.state as { from?: Location } | null)?.from?.pathname;
    return <Navigate to={from ?? '/playground'} replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
