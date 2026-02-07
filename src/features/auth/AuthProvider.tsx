import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'timeout';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  isLoading: boolean; // compat: true ssi 'loading'
  authStatus: AuthStatus;
  signOut: () => Promise<void>;
  retryAuth: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_TIMEOUT_MS = 10_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>('loading');

  const fetchSession = useCallback(() => {
    setAuthStatus('loading');

    const timer = setTimeout(() => {
      // Only transition to timeout if still loading
      setAuthStatus((prev) => (prev === 'loading' ? 'timeout' : prev));
    }, AUTH_TIMEOUT_MS);

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      clearTimeout(timer);
      setSession(s);
      setAuthStatus(s ? 'authenticated' : 'unauthenticated');
    }).catch(() => {
      clearTimeout(timer);
      setAuthStatus('timeout');
    });

    return timer;
  }, []);

  useEffect(() => {
    // 1. Setup listener FIRST (pattern Supabase recommandé)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, s) => {
        setSession(s);
        setAuthStatus(s ? 'authenticated' : 'unauthenticated');
      }
    );

    // 2. Then get initial session with timeout
    const timer = fetchSession();

    return () => {
      clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, [fetchSession]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const retryAuth = useCallback(() => {
    fetchSession();
  }, [fetchSession]);

  const value: AuthContextType = {
    session,
    user: session?.user ?? null,
    isLoading: authStatus === 'loading',
    authStatus,
    signOut,
    retryAuth,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
