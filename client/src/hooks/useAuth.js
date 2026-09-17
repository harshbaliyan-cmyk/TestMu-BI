import { useEffect, useState } from 'react';
import { getMe, logout } from '../lib/api';

export function useAuth() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = logged out

  useEffect(() => {
    getMe().then(setUser).catch(() => setUser(null));
  }, []);

  const signOut = async () => {
    // The server call is not on the cold-start replay list, so a sleeping
    // API rejects it at once. The local half must still happen: a failed
    // request left the user signed in, with the cached filter sets (which
    // can name individual reps) intact on a shared machine.
    try { await logout(); } catch { /* the cookie is gone on the next successful request either way */ }
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