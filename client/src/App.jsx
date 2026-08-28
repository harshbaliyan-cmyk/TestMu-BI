import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import Login from './pages/Login';
import Gallery from './pages/Gallery';
import Dashboard from './pages/Dashboard';
import DataSources from './pages/DataSources';
import Presentation from './pages/Presentation';
import WinBoardPresentation from './pages/WinBoardPresentation';
import LossBoardPresentation from './pages/LossBoardPresentation';
import AppLoader from './components/AppLoader';
import AdminLogs from './pages/AdminLogs';
import WinBoard from './pages/WinBoard';
import LossBoard from './pages/LossBoard';
import AePerformance from './pages/AePerformance';
import AmPerformance from './pages/AmPerformance';
import AePerformancePresentation from './pages/AePerformancePresentation';
import AmPerformancePresentation from './pages/AmPerformancePresentation';
import AccountSettings from './pages/AccountSettings';
import TvDisplay from './pages/TvDisplay';
import ChartBuilder from './pages/ChartBuilder';
import CustomDashboard from './pages/CustomDashboard';

function App() {
  const { user, isLoading } = useAuth();
  // An admin-issued temporary password gets you to exactly one page. The server
  // enforces this too (requireAuth returns 403 password_change_required); this
  // is the matching client half, so the user lands somewhere useful instead of
  // on a wall of failing requests.
  const mustChangePassword = Boolean(user?.mustChangePassword);

  return (
    <div className="app-shell">
      {isLoading ? (
        <AppLoader fullscreen label="Initializing TestMu BI…" />
      ) : (
        <Routes>
          {/* The TV wall route authenticates with the share token in the URL,
              not a session — it must stay reachable with nobody signed in,
              and it outranks the must-change-password catch-all because a
              wall display cannot change anyone's password. */}
          <Route path="/tv/:token" element={<TvDisplay />} />
          {mustChangePassword && <Route path="*" element={<AccountSettings user={user} />} />}
          <Route path="/" element={user ? <Navigate to="/gallery" /> : <Login />} />
          <Route path="/gallery" element={user ? <Gallery user={user} /> : <Navigate to="/" />} />
          <Route path="/dashboard/win-board" element={user ? <WinBoard user={user} /> : <Navigate to="/" />} />
          <Route path="/win-board" element={<Navigate to="/dashboard/win-board" replace />} />
          <Route path="/dashboard/loss-board" element={user ? <LossBoard user={user} /> : <Navigate to="/" />} />
          <Route path="/loss-board" element={<Navigate to="/dashboard/loss-board" replace />} />
          <Route path="/dashboard/ae-performance" element={user ? <AePerformance user={user} /> : <Navigate to="/" />} />
          <Route path="/dashboard/am-performance" element={user ? <AmPerformance user={user} /> : <Navigate to="/" />} />
          <Route path="/dashboard/:templateId" element={user ? <Dashboard user={user} /> : <Navigate to="/" />} />
          <Route path="/charts/new" element={user ? <ChartBuilder /> : <Navigate to="/" />} />
          <Route path="/charts/:chartId/edit" element={user ? <ChartBuilder /> : <Navigate to="/" />} />
          <Route path="/dashboards/custom/:dashboardId" element={user ? <CustomDashboard /> : <Navigate to="/" />} />
          <Route path="/present/win-board" element={user ? <WinBoardPresentation /> : <Navigate to="/" />} />
          <Route path="/present/loss-board" element={user ? <LossBoardPresentation /> : <Navigate to="/" />} />
          <Route path="/present/ae-performance" element={user ? <AePerformancePresentation /> : <Navigate to="/" />} />
          <Route path="/present/am-performance" element={user ? <AmPerformancePresentation /> : <Navigate to="/" />} />
          <Route path="/present/:templateId" element={user ? <Presentation /> : <Navigate to="/" />} />
          <Route path="/account" element={user ? <AccountSettings user={user} /> : <Navigate to="/" />} />
          <Route path="*" element={<Navigate to="/" />} />
          <Route path="/data-sources" element={user ? <DataSources /> : <Navigate to="/" />} />
          <Route path="/admin/logs" element={user?.role === 'admin' ? <AdminLogs /> : <Navigate to="/gallery" />} />
        </Routes>
      )}
    </div>
  );
}

export default App;
