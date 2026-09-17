// Stable preview colors for built-in dashboards across sessions.
const TILE_HUES = [212, 262, 158, 24, 340, 190, 48, 288];
export const hueFor = name => {
  let hash = 0;
  for (const ch of String(name)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TILE_HUES[hash % TILE_HUES.length];
};
