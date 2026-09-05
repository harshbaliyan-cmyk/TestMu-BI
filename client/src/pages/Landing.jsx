import { useEffect, useRef } from 'react';
import Login from './Login';
import MiniViz from '../components/MiniViz';

/**
 * The signed-out front door.
 *
 * A black product tile top to bottom, whichever theme the app is in: the
 * `.landing` block in index.css remaps the app tokens to a dark glass
 * palette, so the real <Login /> card and the shared MiniViz shapes render
 * here without knowing about the page around them.
 *
 * Techniques (epic-design catalogue): six-layer parallax hero with aurora
 * atmosphere, masked line reveal on the headline, elastic drop + float loop
 * on the product, scroll-scrub perspective flatten, floating glass panels at
 * depth 5 in front of the product, mouse parallax, a facts marquee, a bento
 * grid with cursor-tracking glow, word-by-word scroll lighting on the
 * manifesto, IntersectionObserver reveals below the fold.
 *
 * No animation library: the app ships no motion dependency and the
 * presentation deck already chose plain DOM + CSS over a render loop. Every
 * effect is transform / opacity / clip-path from one rAF loop that steps
 * aside for prefers-reduced-motion and drops mouse parallax on coarse
 * pointers.
 */

// Scroll parallax factor per depth level (0 = far background, 5 = foreground).
const PARALLAX = [0.10, 0.25, 0.50, 0.80, 1.00, 1.20];
// Mouse parallax amplitude in px per depth. Depth 4 is the reading layer and
// the login form: it must never drift under the cursor.
const MOUSE = [6, 12, 18, 14, 0, 30];

// Names and blurbs mirror the server's TEMPLATES registry so the front door
// and the gallery never describe two different products.
const BOARDS = [
  { id: 'opportunity-analytics', name: 'Opportunity Analytics', viz: 'funnel', size: '2x2', blurb: 'Six tabs over the canonical schema: searchable multi-select filters, date ranges, saved views and Top-N tables.', tags: ['Pulse', 'Diagnostics', 'Velocity & Aging', 'Where We Win', 'Rep Performance', 'Accounts & Whitespace'] },
  { id: 'executive-dashboard', name: 'Executive Dashboard', viz: 'tiles', size: '2x1', blurb: 'Quota attainment, pipeline coverage, forecast and trials. The current quarter at a glance.' },
  { id: 'win-board', name: 'Win Board', viz: 'bars', blurb: 'Won ARR, win rate, POD and team contribution, period comparison.' },
  { id: 'loss-board', name: 'Loss Board', viz: 'reasons', blurb: 'ARR lost rate, loss reasons, lost-after-trial.' },
  { id: 'product-view', name: 'Product View', viz: 'stack', blurb: 'Pipeline by created date, Won ARR by close date, per product.' },
  { id: 'ae-performance', name: 'AE Performance', viz: 'rank', blurb: 'Ranking by share of closed ARR, with rep-status rules.' },
  { id: 'am-performance', name: 'AM Performance', viz: 'donut', size: '2x1', blurb: 'Rep ranking by percent of quota achieved, with POD attainment. AE and AM share one tested metric engine.' },
];

// Every line is a documented behaviour, not a marketing claim.
const TICKER = [
  'TV walls refetch every 60 seconds',
  'Tableau webhooks re-pull within moments of a refresh',
  'Sync cron every 2 hours by default',
  'Personal access tokens encrypted AES-256-GCM at rest',
  'Share links open one board, read-only, revocable',
  'Twelve-column custom dashboard grid',
  'Saved charts are versioned configs',
  'Per-column profiles captured at every sync',
  'Sessions live in Postgres and revoke in bulk',
  'Rate-limited, timing-equalised sign-in',
];

const SOURCES = [
  { name: 'Tableau published data source', body: 'Read through the VizQL Data Service. Re-pulled on the sync schedule and within moments of a refresh-succeeded webhook.', glyph: 'db' },
  { name: 'Tableau view', body: 'Pulled as a CSV export on the same schedule. Workbook-embedded sources are deliberately out of scope.', glyph: 'table' },
  { name: 'File upload', body: 'CSV, TSV, XLSX, XLS or JSON up to 25 MB. Same preview, same mapping, same boards.', glyph: 'file' },
];

const MANIFESTO = 'Every user sees only the sources they connected. Tokens are encrypted at rest and never reach the browser. A share link opens one board, read-only, and dies the moment you revoke it.';

const CHART_TYPES = ['Bar', 'Time series', 'Donut', 'KPI tile', 'Scatter', 'Table'];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function Glyph({ kind }) {
  const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  if (kind === 'db') return <svg {...common}><ellipse cx="12" cy="5.5" rx="8" ry="3" /><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>;
  if (kind === 'table') return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 10v10M15 10v10" /></svg>;
  return <svg {...common}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>;
}

function HeroMock() {
  return (
    <div className="ld-mock" role="img" aria-label="Illustrative preview of the Executive Dashboard with sample numbers">
      <div className="ld-mock-bar">
        <span className="ld-mock-brand"><img src="/testmu-bi-logo-v3.png" alt="" /> Executive Dashboard</span>
        <span className="ld-mock-chips"><i>Q3-2026</i><i>All PODs</i><i>New Business</i></span>
        <span className="ld-mock-stamp"><b /> Sample data</span>
      </div>
      <div className="ld-mock-kpis">
        {[['Quota attainment', '84%', '+6 pts vs last quarter'], ['Pipeline coverage', '3.2×', 'against 2.8× target'], ['Forecast', '$1.9M', 'Commit + Best case'], ['Trials in flight', '41', '12 new this week']].map(([k, v, d], i) => (
          <div className="ld-mock-kpi" key={k} style={{ '--i': i }}><small>{k}</small><b>{v}</b><span>{d}</span></div>
        ))}
      </div>
      <div className="ld-mock-grid">
        <div className="ld-mock-card">
          <h4>Won ARR by month</h4>
          <div className="ld-bars">{[34, 48, 42, 61, 57, 74, 69, 88, 81, 96].map((h, i) => <i key={i} style={{ '--h': h, '--i': i }} />)}</div>
        </div>
        <div className="ld-mock-card ld-mock-line">
          <h4>Pipeline created</h4>
          <svg viewBox="0 0 200 70" preserveAspectRatio="none">
            <path className="area" d="M0 58 C 20 52, 30 40, 50 44 S 80 28, 100 30 S 135 18, 155 14 S 185 6, 200 4 L200 70 L0 70 Z" />
            <path d="M0 58 C 20 52, 30 40, 50 44 S 80 28, 100 30 S 135 18, 155 14 S 185 6, 200 4" />
          </svg>
        </div>
        <div className="ld-mock-card">
          <h4>Rep ranking</h4>
          <div className="ld-rank">
            {[['Riya', 112], ['Dev', 94], ['Sam', 81], ['Zed', 63]].map(([n, w], i) => <div key={n} style={{ '--w': Math.min(w, 100), '--i': i }}><span>{n}</span><i /><b>{w}%</b></div>)}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  const rootRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    if (reduce) { root.classList.add('ld-static'); return undefined; }

    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });
    root.querySelectorAll('[data-reveal]').forEach(el => io.observe(el));

    const hero = root.querySelector('.ld-hero');
    const layers = Array.from(hero.querySelectorAll('[data-depth]'));
    const bento = root.querySelector('.ld-grid');
    const manifesto = root.querySelector('.ld-manifesto');
    const words = Array.from(root.querySelectorAll('.ld-manifesto .w'));

    let mouseX = 0, mouseY = 0, easedX = 0, easedY = 0;
    let raf = 0;
    let litCount = -1;

    const frame = () => {
      raf = 0;
      const y = window.scrollY;
      const vh = window.innerHeight;

      // Hero: scrub progress flattens the product over the first 70vh; layers
      // drift by depth for scroll and mouse. The two full-bleed background
      // layers take mouse drift only: a scroll shift would slide their
      // clipped boxes out below the hero.
      const heroLive = y < hero.offsetHeight + vh * 0.2;
      if (heroLive) {
        hero.style.setProperty('--p', clamp(y / (vh * 0.7), 0, 1).toFixed(4));
        easedX += (mouseX - easedX) * 0.08;
        easedY += (mouseY - easedY) * 0.08;
        layers.forEach(layer => {
          const depth = Number(layer.dataset.depth);
          const shift = depth >= 2 ? y * (1 - PARALLAX[depth]) * 0.3 : 0;
          layer.style.transform = `translate3d(${(easedX * MOUSE[depth]).toFixed(2)}px, ${(shift + easedY * MOUSE[depth]).toFixed(2)}px, 0)`;
        });
        hero.classList.add('is-live');
      } else {
        hero.classList.remove('is-live');
      }

      // Manifesto: words light in reading order as the block crosses the
      // lower third of the viewport.
      if (manifesto) {
        const box = manifesto.getBoundingClientRect();
        if (box.bottom > 0 && box.top < vh) {
          const t = clamp((vh * 0.8 - box.top) / (box.height + vh * 0.3), 0, 1);
          const lit = Math.round(t * words.length);
          if (lit !== litCount) {
            litCount = lit;
            words.forEach((w, i) => w.classList.toggle('lit', i < lit));
          }
        }
      }

      const settling = heroLive && (Math.abs(mouseX - easedX) > 0.002 || Math.abs(mouseY - easedY) > 0.002);
      if (settling) raf = requestAnimationFrame(frame);
    };
    const request = () => { if (!raf) raf = requestAnimationFrame(frame); };

    const onMove = event => {
      mouseX = (event.clientX / window.innerWidth - 0.5) * 2;
      mouseY = (event.clientY / window.innerHeight - 0.5) * 2;
      request();
    };
    const onLeave = () => { mouseX = 0; mouseY = 0; request(); };

    // Bento tiles carry a glow that follows the cursor: two custom
    // properties on the hovered tile, painted by a radial gradient in CSS.
    const onTileMove = event => {
      const tile = event.target.closest('.ld-tile');
      if (!tile) return;
      const box = tile.getBoundingClientRect();
      tile.style.setProperty('--mx', `${Math.round(event.clientX - box.left)}px`);
      tile.style.setProperty('--my', `${Math.round(event.clientY - box.top)}px`);
    };

    // In-page links scroll smoothly and hand focus to the target so keyboard
    // users land in the form, not just next to it.
    const onAnchor = event => {
      const link = event.target.closest('a[href^="#"]');
      if (!link) return;
      const target = root.querySelector(link.getAttribute('href'));
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: link.hash === '#signin' ? 'center' : 'start' });
      // querySelector with a list returns the first in DOM order, and the card
      // puts its heading before its inputs: ask for the input first.
      const field = target.querySelector('input') || target.querySelector('button') || target.querySelector('h2, h3');
      if (field) {
        if (!field.hasAttribute('tabindex') && !/^(INPUT|BUTTON)$/.test(field.tagName)) field.setAttribute('tabindex', '-1');
        field.focus({ preventScroll: true });
      }
    };

    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', request);
    root.addEventListener('click', onAnchor);
    if (!coarse) {
      hero.addEventListener('pointermove', onMove);
      hero.addEventListener('pointerleave', onLeave);
      bento?.addEventListener('pointermove', onTileMove);
    }
    request();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener('scroll', request);
      window.removeEventListener('resize', request);
      root.removeEventListener('click', onAnchor);
      hero.removeEventListener('pointermove', onMove);
      hero.removeEventListener('pointerleave', onLeave);
      bento?.removeEventListener('pointermove', onTileMove);
    };
  }, []);

  return (
    <div className="landing" ref={rootRef}>
      <a className="ld-skip" href="#signin">Skip to sign in</a>

      <header className="ld-nav">
        <a className="ld-brand" href="#top" aria-label="TestMu BI">
          <img src="/testmu-bi-logo-v3.png" alt="" width="34" height="34" />
          <span>TestMu BI</span>
        </a>
        <nav className="ld-nav-links" aria-label="Page">
          <a href="#boards">Boards</a>
          <a href="#builder">Chart builder</a>
          <a href="#tv">TV walls</a>
          <a href="#sources">Sources</a>
        </nav>
        <div className="ld-nav-actions">
          <a className="ld-btn ld-btn-primary ld-btn-sm" href="#signin">Sign in</a>
        </div>
      </header>

      <main id="top">
        {/* ---------------- HERO: six depth layers ---------------- */}
        <section className="ld-hero scene" data-scene="hero" aria-labelledby="ld-title">
          <div className="layer depth-0" data-depth="0" aria-hidden="true" />
          <div className="layer depth-1" data-depth="1" aria-hidden="true">
            <i className="ld-aurora ld-aurora-1" />
            <i className="ld-aurora ld-aurora-2" />
            <i className="ld-aurora ld-aurora-3" />
          </div>

          <div className="layer depth-4 ld-hero-grid" data-depth="4">
            <div className="ld-hero-copy">
              <p className="ld-status" style={{ '--i': 0 }}><i /> Synced from Tableau Cloud · webhooks and a 2 h cron</p>
              <h1 className="ld-h1" id="ld-title">
                <span className="ld-line" style={{ '--i': 1 }}><span>Every deal. Every rep.</span></span>
                <span className="ld-line" style={{ '--i': 2 }}><span className="ld-grad-text">Live on every screen.</span></span>
              </h1>
              <p className="ld-sub" style={{ '--i': 3 }}>
                TestMu BI reads your published Tableau sources and turns them into seven ready-made
                sales boards, a chart builder for everything else, and TV walls that refresh
                themselves. No exports. No spreadsheets.
              </p>
              <div className="ld-cta-row" style={{ '--i': 4 }}>
                <a className="ld-btn ld-btn-primary" href="#signin">Sign in</a>
                <a className="ld-btn ld-btn-ghost" href="#boards">See the boards</a>
              </div>
              <p className="ld-trust" style={{ '--i': 5 }}>Work accounts only · Access is invited by your admin</p>
            </div>
            <div className="ld-hero-card">
              <Login embedded />
            </div>
          </div>

          <div className="ld-stage">
            <div className="layer depth-3" data-depth="3">
              <div className="ld-mock-drop">
                <div className="ld-mock-float">
                  <HeroMock />
                </div>
              </div>
            </div>
            {/* Glass panels floating in front of the product. */}
            <div className="layer depth-5 ld-floats" data-depth="5" aria-hidden="true">
              <div className="ld-float ld-float-kpi" style={{ '--z': '110px', '--dur': '8s' }}>
                <small>Won ARR</small><b>$4.2M</b><span className="up">▲ 18% quarter over quarter</span>
              </div>
              <div className="ld-float ld-float-ring" style={{ '--z': '90px', '--dur': '11s' }}>
                <i className="ld-ring"><b>84%</b></i><span><small>Quota attainment</small>Q3 to date</span>
              </div>
              <div className="ld-float ld-float-toast" style={{ '--z': '120px', '--dur': '13s' }}>
                <i className="ld-check" /><span><b>refresh-succeeded</b><small>Tableau webhook · re-pulled in 4 s</small></span>
              </div>
              <div className="ld-float ld-float-stamp" style={{ '--z': '70px', '--dur': '10s' }}>
                <i className="ld-dot" /><span>Data updated 09:41 · TV wall</span>
              </div>
            </div>
          </div>

          <div className="layer depth-5 ld-particles" data-depth="5" aria-hidden="true">
            {[[8, 22, 0], [18, 68, 3], [31, 14, 6], [57, 82, 2], [72, 26, 5], [88, 60, 1], [94, 18, 4], [44, 48, 7]].map(([x, y, d], i) => (
              <i key={i} style={{ left: `${x}%`, top: `${y}%`, animationDelay: `-${d}s` }} />
            ))}
          </div>
        </section>

        {/* ---------------- TICKER ---------------- */}
        <section className="ld-marquee" aria-label="How it runs">
          <div className="ld-marquee-track">
            {TICKER.map(t => <span key={t}>{t}</span>)}
            {TICKER.map(t => <span key={`${t}-dup`} aria-hidden="true">{t}</span>)}
          </div>
        </section>

        {/* ---------------- BOARDS: bento grid ---------------- */}
        <section className="ld-bento" id="boards" aria-labelledby="ld-boards-title">
          <div className="ld-section-head" data-reveal>
            <p className="ld-eyebrow">Fixed boards</p>
            <h2 id="ld-boards-title">Seven boards, built by hand,<br />wired to your data.</h2>
            <p className="ld-lead">
              Each one is a page in the app, not a template you configure. The metric math lives
              in tested pure functions on the server. The boards just show it.
            </p>
          </div>
          <ul className="ld-grid" data-reveal>
            {BOARDS.map((b, i) => (
              <li className={`ld-tile ld-tile-${b.size || '1x1'}`} key={b.id} data-stagger style={{ '--i': i }}>
                <span className="ld-tile-index">0{i + 1}</span>
                <h3>{b.name}</h3>
                <p>{b.blurb}</p>
                {b.tags && <div className="ld-tile-tabs">{b.tags.map(t => <span key={t}>{t}</span>)}</div>}
                <MiniViz kind={b.viz} />
              </li>
            ))}
          </ul>
        </section>

        {/* ---------------- CHART BUILDER ---------------- */}
        <section className="ld-feature" id="builder" aria-labelledby="ld-builder-title" data-reveal>
          <div className="ld-feature-copy">
            <p className="ld-eyebrow">Chart builder</p>
            <h2 id="ld-builder-title">For everything the boards don't cover.</h2>
            <p className="ld-lead">
              Pick any connected source. Chart types the dataset cannot satisfy are greyed out with
              the reason. Slots arrive pre-filled from the column profiles and stay overridable, filters
              apply before aggregation, and every bar opens the raw rows behind it.
            </p>
            <ul className="ld-checks">
              <li data-stagger style={{ '--i': 0 }}>Bar, time series, donut, KPI tile, scatter and table</li>
              <li data-stagger style={{ '--i': 1 }}>Saved charts are versioned configs, so they follow every sync</li>
              <li data-stagger style={{ '--i': 2 }}>Custom dashboards: a twelve-column grid, one chart on many boards</li>
            </ul>
          </div>
          <div className="ld-feature-visual ld-builder" aria-hidden="true">
            <div className="ld-builder-side">
              <div className="ld-builder-types">
                {CHART_TYPES.map((t, i) => <i key={t} className={i === 1 ? 'is-on' : i === 4 ? 'is-off' : ''}>{t}</i>)}
              </div>
              {[['Category', 'Region'], ['Value', 'ARR · sum'], ['Series', 'Product'], ['Date', 'Close date · month']].map(([k, v], i) => (
                <div className="ld-slot" key={k} data-stagger style={{ '--i': i + 1 }}><small>{k}</small><b>{v}</b></div>
              ))}
              <div className="ld-slot ld-slot-filter" data-stagger style={{ '--i': 5 }}><small>Filter</small><b>Type is New Business</b></div>
            </div>
            <div className="ld-builder-preview">
              <div className="ld-builder-head"><b>ARR by region</b><span>Live preview</span></div>
              <MiniViz kind="bars" className="viz-series" />
              <div className="ld-builder-rows"><b>Click a bar</b><span>opens the rows behind it · filter chart to this</span></div>
            </div>
          </div>
        </section>

        {/* ---------------- TV WALLS ---------------- */}
        <section className="ld-feature is-flipped" id="tv" aria-labelledby="ld-tv-title" data-reveal>
          <div className="ld-feature-copy">
            <p className="ld-eyebrow">Presentation mode</p>
            <h2 id="ld-tv-title">Put it on the wall. Leave it there.</h2>
            <p className="ld-lead">
              Every board has a 16:9 presentation mode with auto-rotating slides, a screen wake lock,
              and a "Data updated" stamp that turns red the moment the network drops. Failed refreshes
              keep the last good numbers. The stalled stamp is the signal.
            </p>
            <ul className="ld-checks">
              <li data-stagger style={{ '--i': 0 }}>Share links open one board with no login</li>
              <li data-stagger style={{ '--i': 1 }}>Tokens are stored hash-only and scoped to exactly that board</li>
              <li data-stagger style={{ '--i': 2 }}>Revoke from the Account page, or let it expire</li>
            </ul>
          </div>
          <div className="ld-feature-visual ld-tv" aria-hidden="true">
            <div className="ld-tv-frame">
              <div className="ld-tv-screen">
                <div className="ld-tv-top"><b>Win Board</b><span className="ld-tv-stamp"><i /> Data updated 09:41</span></div>
                <div className="ld-tv-kpis">{[['Won ARR', '$4.2M'], ['Win rate', '31%'], ['Deals', '128']].map(([k, v]) => <div key={k}><small>{k}</small><b>{v}</b></div>)}</div>
                <MiniViz kind="bars" className="viz-tv" />
                <div className="ld-tv-dots"><i className="on" /><i /><i /><i /></div>
              </div>
            </div>
            <div className="ld-tv-link"><b>/tv/…</b><span>one board · read-only · revocable</span></div>
          </div>
        </section>

        {/* ---------------- SOURCES ---------------- */}
        <section className="ld-sources" id="sources" aria-labelledby="ld-sources-title" data-reveal>
          <div className="ld-section-head">
            <p className="ld-eyebrow">Data sources</p>
            <h2 id="ld-sources-title">Three ways in. One canonical schema.</h2>
            <p className="ld-lead">
              Preview, auto-mapped field suggestions against the opportunity schema, fill rates and
              samples per column, then commit to one or more boards. Re-committing the same source
              supersedes its previous binding.
            </p>
          </div>
          <ul className="ld-source-grid">
            {SOURCES.map((s, i) => (
              <li className="ld-source" key={s.name} data-stagger style={{ '--i': i }}>
                <span className="ld-source-glyph"><Glyph kind={s.glyph} /></span>
                <h3>{s.name}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ---------------- MANIFESTO: word-by-word lighting ---------------- */}
        <section className="ld-manifesto-wrap" aria-label="Tenancy and security">
          <p className="ld-manifesto">
            {MANIFESTO.split(' ').map((w, i) => <span className="w" key={i}>{w} </span>)}
          </p>
        </section>

        {/* ---------------- FINAL CTA ---------------- */}
        <section className="ld-final" aria-labelledby="ld-final-title" data-reveal>
          <div className="ld-final-panel">
            <p className="ld-eyebrow">Ready when your data is</p>
            <h2 id="ld-final-title">Connect a Tableau source.<br />Open a board.</h2>
            <p className="ld-lead">Sign in with your work account. If you do not have one yet, your admin issues a temporary password that you change on first sign-in.</p>
            <div className="ld-cta-row ld-cta-center">
              <a className="ld-btn ld-btn-primary" href="#signin">Sign in</a>
            </div>
          </div>
        </section>
      </main>

      <footer className="ld-footer">
        <span>TestMu BI · Sales analytics on live Tableau data</span>
        <span>Built for desk browsers and 16:9 TVs</span>
      </footer>
    </div>
  );
}
