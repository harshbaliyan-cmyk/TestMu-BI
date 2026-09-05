/**
 * Small decorative chart shapes: the landing page's board tiles and the
 * gallery's template cards draw the same set, so a board looks the same at
 * the front door and inside. Nothing here is data; every element is
 * aria-hidden and the numbers are illustrative.
 *
 * Styling lives under `.viz` in index.css and reads three custom properties
 * with app-token fallbacks: --viz-accent, --viz-surface, --viz-line. The
 * bars, rings and rows animate in when an ancestor carries `.is-in` (set by
 * an IntersectionObserver on the landing and after mount on the gallery).
 */

// One shape per board id. Unknown ids fall back to bars.
export const VIZ_BY_TEMPLATE = {
  'opportunity-analytics': 'funnel',
  'event-analytics': 'line',
  'tenant-health': 'heat',
  'win-board': 'bars',
  'loss-board': 'reasons',
  'product-view': 'stack',
  'executive-dashboard': 'tiles',
  'am-performance': 'donut',
  'ae-performance': 'rank',
};

export default function MiniViz({ kind = 'bars', className = '' }) {
  const cls = `viz viz-${kind}${className ? ` ${className}` : ''}`;
  switch (kind) {
    case 'rank':
      return <div className={cls} aria-hidden="true">{[96, 81, 67, 54, 41].map((w, i) => <div key={i} style={{ '--w': w, '--i': i }}><b>0{i + 1}</b><i /><span>{w}%</span></div>)}</div>;
    case 'reasons':
      return <div className={`${cls} viz-rank`} aria-hidden="true">{[['Price', 72], ['Feature gap', 48], ['Competitor', 36], ['No budget', 22]].map(([k, w], i) => <div key={k} style={{ '--w': w, '--i': i }}><b>{k}</b><i /><span>{w}</span></div>)}</div>;
    case 'donut':
      return <div className={cls} aria-hidden="true"><div className="viz-ring"><b>78%</b></div><ul><li>Hit</li><li>In reach</li><li>Slipping</li></ul></div>;
    case 'tiles':
      return <div className={cls} aria-hidden="true">{[['Quota', '84%'], ['Coverage', '3.2×'], ['Forecast', '$1.9M'], ['Trials', '41']].map(([k, v], i) => <div key={k} style={{ '--i': i }}><small>{k}</small><b>{v}</b></div>)}</div>;
    case 'funnel':
      return <div className={cls} aria-hidden="true">{[100, 74, 52, 33, 18].map((w, i) => <i key={i} style={{ '--w': w, '--i': i }} />)}</div>;
    case 'stack':
      return <div className={cls} aria-hidden="true">{[[46, 28, 26], [38, 40, 22], [52, 20, 28], [30, 34, 36]].map((row, i) => <div key={i} style={{ '--i': i }}>{row.map((w, j) => <i key={j} style={{ '--w': w }} />)}</div>)}</div>;
    case 'line':
      return (
        <div className={cls} aria-hidden="true">
          <svg viewBox="0 0 200 70" preserveAspectRatio="none">
            <path className="area" d="M0 52 C 18 46, 30 58, 48 40 S 78 30, 98 34 S 130 12, 150 18 S 184 8, 200 4 L200 70 L0 70 Z" />
            <path d="M0 52 C 18 46, 30 58, 48 40 S 78 30, 98 34 S 130 12, 150 18 S 184 8, 200 4" />
          </svg>
        </div>
      );
    case 'heat':
      return <div className={cls} aria-hidden="true">{[5, 8, 3, 9, 6, 2, 7, 4, 9, 5, 8, 3, 6, 9, 2, 7, 5, 8, 4, 6, 9, 3, 7, 5, 8, 6, 2, 9, 4, 7, 3, 8, 6, 5, 9].map((v, i) => <i key={i} style={{ '--v': v / 10, '--i': i }} />)}</div>;
    case 'bars':
    default:
      return <div className={`viz viz-bars${className ? ` ${className}` : ''}`} aria-hidden="true">{[38, 52, 46, 70, 64, 88, 76, 96].map((h, i) => <i key={i} style={{ '--h': h, '--i': i }} />)}</div>;
  }
}
