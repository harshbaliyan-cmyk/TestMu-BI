import { useEffect, useState } from 'react';

const read = key => {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value.filter(path => typeof path === 'string' && path.startsWith('/dashboard/')) : [];
  } catch { return []; }
};

export function useWorkspaceFavorites(userId) {
  const key = `testmu-workspace-favorites-${userId}`;
  const [favorites, setFavorites] = useState(() => read(key));
  useEffect(() => {
    const sync = event => { if (!event?.key || event.key === key) setFavorites(read(key)); };
    sync();
    window.addEventListener('workspacefavoriteschange', sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener('workspacefavoriteschange', sync); window.removeEventListener('storage', sync); };
  }, [key]);
  const toggleFavorite = path => {
    const next = favorites.includes(path) ? favorites.filter(item => item !== path) : [...favorites, path];
    setFavorites(next);
    try { localStorage.setItem(key, JSON.stringify(next)); window.dispatchEvent(new Event('workspacefavoriteschange')); } catch { /* Keep the current session usable if storage is unavailable. */ }
  };
  return { favorites, toggleFavorite };
}
