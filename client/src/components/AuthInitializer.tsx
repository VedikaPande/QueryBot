import { useEffect, useRef } from 'react';
import { useAppDispatch } from '@/hooks/redux';
import { checkAuthentication } from '@/store/slices/authSlice';

interface AuthInitializerProps {
  children: React.ReactNode;
}

/**
 * Establishes the session once at start-up.
 *
 * Children render immediately: `ProtectedRoute` handles the loading state for
 * guarded routes, so public pages need not wait behind a full-screen spinner.
 */
const AuthInitializer = ({ children }: AuthInitializerProps) => {
  const dispatch = useAppDispatch();
  // React 18+ mounts twice in development; this keeps it to a single request.
  const hasChecked = useRef(false);

  useEffect(() => {
    if (hasChecked.current) return;
    hasChecked.current = true;

    void dispatch(checkAuthentication(true));
  }, [dispatch]);

  return <>{children}</>;
};

export default AuthInitializer;
