import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { APP_USER_COLUMNS, type AppUser } from '../lib/types';
import { setQueueOwner } from '../lib/offlineQueue';

interface AuthState {
  session: Session | null;
  appUser: AppUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshAppUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadAppUser(authId: string) {
    const { data } = await supabase.from('users').select(APP_USER_COLUMNS).eq('auth_id', authId).single();
    setAppUser(data ?? null);
  }

  useEffect(() => setQueueOwner(appUser?.id ?? null), [appUser?.id]);

  useEffect(() => {
    let currentUserId: string | null = null;

    // session and appUser must land together, or ProtectedRoute and Login
    // bounce a signed-in user between each other.
    async function apply(newSession: Session | null) {
      if (newSession?.user.id === currentUserId) {
        setSession(newSession); // token refresh / tab refocus: same user, keep the UI mounted
        return;
      }
      setLoading(true);
      currentUserId = newSession?.user.id ?? null;
      setSession(newSession);
      if (newSession) await loadAppUser(newSession.user.id);
      else setAppUser(null);
      setLoading(false);
    }

    supabase.auth
      .getSession()
      .then(({ data }) => apply(data.session))
      .catch(() => setLoading(false));

    // Deferred: awaiting a Supabase call inside this callback can deadlock the client.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setTimeout(() => void apply(newSession), 0);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        appUser,
        loading,
        signOut: async () => {
          await supabase.auth.signOut();
        },
        refreshAppUser: async () => {
          if (session) await loadAppUser(session.user.id);
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
