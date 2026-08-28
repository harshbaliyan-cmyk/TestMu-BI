import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { setShareToken, resolveShareToken } from '../lib/api';
import AppLoader from '../components/AppLoader';
import Presentation from './Presentation';
import TvCustomDashboard from './TvCustomDashboard';
import WinBoardPresentation from './WinBoardPresentation';
import LossBoardPresentation from './LossBoardPresentation';
import AePerformancePresentation from './AePerformancePresentation';
import AmPerformancePresentation from './AmPerformancePresentation';

const BOARDS = {
  'win-board': WinBoardPresentation,
  'loss-board': LossBoardPresentation,
  'ae-performance': AePerformancePresentation,
  'am-performance': AmPerformancePresentation,
};

// The wall display's front door. No session, no nav: the token in the URL is
// the whole credential, scoped server-side to one dashboard. The token is
// installed as a default header BEFORE the first render of the board, so every
// data call the presentation makes is authenticated the same way.
export default function TvDisplay() {
  const { token } = useParams();
  const [resolved, setResolved] = useState({ status: 'checking' });

  useEffect(() => {
    setShareToken(token);
    resolveShareToken()
      .then(({ templateKey, customDashboardId }) => setResolved({ status: 'ok', templateKey, customDashboardId }))
      .catch(error => setResolved({
        status: 'error',
        message: error.response?.data?.error || 'Could not open this share link.',
      }));
    return () => setShareToken(null);
  }, [token]);

  if (resolved.status === 'checking') return <AppLoader fullscreen label="Opening display…" />;
  if (resolved.status === 'error') {
    // Deliberately says nothing about WHY beyond the server's generic line —
    // a revoked link on a public wall should not explain itself to passers-by.
    return <main className="tv-share-error">
      <img src="/testmu-bi-logo-v2.png" alt="TestMu BI" />
      <h1>This display link is not active</h1>
      <p>{resolved.message}</p>
      <p>Ask whoever set up this screen to create a fresh link from the dashboard&rsquo;s Present view.</p>
    </main>;
  }
  if (resolved.customDashboardId) return <TvCustomDashboard dashboardId={resolved.customDashboardId} />;
  const Board = BOARDS[resolved.templateKey];
  return Board ? <Board share /> : <Presentation share templateId={resolved.templateKey} />;
}
