import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { ApiError, getMe, logout as apiLogout } from './api';
import type { User } from './types';

interface AuthState {
  user: User | null;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({ user: null, loading: true, logout: async () => undefined });

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Ask the backend who is logged in (it reads the HTTP-only session cookie).
  useEffect(() => {
    getMe()
      .then(setUser)
      .catch((error: unknown) => {
        if (!(error instanceof ApiError) || error.status !== 401) console.error(error);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  async function logout() {
    await apiLogout();
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, logout }}>{children}</AuthContext.Provider>;
}
