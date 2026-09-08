import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { AppUser } from '../lib/types';

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
    const { data } = await supabase.from('users').select('*').eq('auth_id', authId).single();
    setAppUser(data ?? null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session) await loadAppUser(data.session.user.id);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      /* session and appUser must land together, same as the initial load
         below — otherwise ProtectedRoute sees a signed-in session with no
         appUser yet and bounces to /login while Login, seeing the same
         session, bounces back to /, and the page goes blank until a manual
         refresh re-runs the initial load (which does fetch both first). */
      setLoading(true);
      setSession(newSession);
      if (newSession) {
        await loadAppUser(newSession.user.id);
      } else {
        setAppUser(null);
      }
      setLoading(false);
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
