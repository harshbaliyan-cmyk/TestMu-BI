export default function AppLoader({ fullscreen = false, label = 'Loading…' }) {
  return (
    <div className={fullscreen ? 'app-loader' : 'app-loader app-loader-inline'}>
      <div className="app-loader-ring"><i /><i /><i /></div>
      <div className="app-loader-text">{label}</div>
    </div>
  );
}
