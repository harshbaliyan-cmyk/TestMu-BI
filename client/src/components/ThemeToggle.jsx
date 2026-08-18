import { useEffect, useState } from 'react';
import Chart from 'chart.js/auto';

const getTheme = () => document.documentElement.dataset.theme ||
  localStorage.getItem('testmu-theme') || 'dark';

export default function ThemeToggle() {
  const [theme, setTheme] = useState(getTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('testmu-theme', theme);
    const light = theme === 'light';
    const text = light ? '#56657A' : '#B7C2D3';
    const muted = light ? '#657489' : '#9CACBF';
    const line = light ? '#D7DFE9' : '#2A3A55';
    Object.values(Chart.instances).forEach(chart => {
      const plugins = chart.options?.plugins;
      if (plugins?.legend?.labels) plugins.legend.labels.color = text;
      if (plugins?.tooltip) {
        Object.assign(plugins.tooltip, {
          backgroundColor: light ? 'rgba(255,255,255,.97)' : 'rgba(15,23,42,.96)',
          titleColor: light ? '#162033' : '#FFFFFF',
          bodyColor: light ? '#334155' : '#FFFFFF',
          borderColor: line,
        });
      }
      Object.values(chart.options?.scales || {}).forEach(scale => {
        if (scale?.ticks) scale.ticks.color = muted;
        if (scale?.border) scale.border.color = line;
      });
      chart.update('none');
    });
    window.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
  }, [theme]);

  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className="theme-toggle" onClick={() => setTheme(next)}
      title={`Switch to ${next} mode`} aria-label={`Switch to ${next} mode`}>
      <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
      <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
    </button>
  );
}
