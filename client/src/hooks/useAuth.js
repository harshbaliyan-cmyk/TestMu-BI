import { useEffect, useState } from 'react';
import { getMe, logout } from '../lib/api';

export function useAuth() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = logged out

  useEffect(() => {
    getMe().then(setUser).catch(() => setUser(null));
  }, []);

  const signOut = async () => {
    await logout();
    setUser(null);
    // Dashboard and presentation state is cached locally for instant restore,
    // and a saved filter set can name individual sales reps. On a shared
    // machine that should not outlive the session — the server holds the
    // authoritative copy, so clearing costs nothing but one refetch.
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('testmu-dashboard-state-') || key.endsWith('-presentation-config')) {
        localStorage.removeItem(key);
      }
    }
    window.location.href = '/';
  };

  return { user, isLoading: user === undefined, signOut };
}