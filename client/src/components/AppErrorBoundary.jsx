import React from 'react';

function dashboardPathFor(pathname) {
  const presentationMatch = pathname.match(/^\/present\/([^/?#]+)/);
  if (presentationMatch) return `/dashboard/${presentationMatch[1]}`;
  if (pathname.startsWith('/dashboard/')) return '/gallery';
  return '/gallery';
}

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, retryKey: 0 };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('TestMu BI recovered from a rendering error.', error, info);
  }

  retry = () => {
    this.setState((state) => ({ error: null, retryKey: state.retryKey + 1 }));
  };

  reload = () => {
    window.location.reload();
  };

  backToDashboard = () => {
    window.location.assign(dashboardPathFor(window.location.pathname));
  };

  render() {
    const { error, retryKey } = this.state;

    if (error) {
      return (
        <main className="app-error-page" role="alert" aria-live="assertive">
          <section className="app-error-card">
            <div className="app-error-icon" aria-hidden="true">!</div>
            <div>
              <p className="app-error-eyebrow">DISPLAY RECOVERY</p>
              <h1>This dashboard hit a temporary display error</h1>
              <p className="app-error-copy">
                Your saved filters and source data were not changed. Retry the view, or return to the dashboard.
              </p>
            </div>
            <div className="app-error-actions">
              <button type="button" className="app-error-primary" onClick={this.retry}>Retry view</button>
              <button type="button" onClick={this.reload}>Reload page</button>
              <button type="button" onClick={this.backToDashboard}>Back to dashboard</button>
            </div>
          </section>
        </main>
      );
    }

    return <React.Fragment key={retryKey}>{this.props.children}</React.Fragment>;
  }
}

export default AppErrorBoundary;
