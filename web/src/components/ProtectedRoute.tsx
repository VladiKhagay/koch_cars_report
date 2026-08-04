import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../lib/types';

export default function ProtectedRoute({ roles, children }: { roles?: UserRole[]; children: ReactNode }) {
  const { session, appUser, loading } = useAuth();

  if (loading) return null;
  if (!session) return <Navigate to="/login" replace />;
  if (!appUser || !appUser.active) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(appUser.role)) return <Navigate to="/" replace />;

  return <>{children}</>;
}
