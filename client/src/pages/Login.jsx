import { useEffect, useRef, useState } from 'react';
import { getAuthConfig, loginWithPassword, onApiWaking, signupWithPassword, verifyGoogleToken } from '../lib/api';
import ThemeToggle from '../components/ThemeToggle';

// A failure with no response, or a gateway status, means the request never
// got an answer from the application - the retry in api.js has already spent
// its attempts waking the server. Saying "Sign in failed" there blames the
// person's password for an outage, which is what sent this to support.
function describeAuthError(requestError, mode) {
  const served = requestError?.response?.data?.error;
  if (served) return served;
  const status = requestError?.response?.status;
  if (!requestError?.response || [502, 503, 504].includes(status)) {
    return 'The server is still starting up and did not answer in time. Wait a moment and try again.';
  }
  return `${mode === 'signup' ? 'Account creation' : 'Sign in'} failed.`;
}

export default function Login() {
  const googleButton = useRef(null);
  const [config, setConfig] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  // The API sleeps on Render's free plan and takes most of a minute to wake.
  // Without saying so, that wait looks like a hung button and the failure that
  // follows looks like a wrong password.
  const [waking, setWaking] = useState(false);
  useEffect(() => onApiWaking(setWaking), []);

  useEffect(() => {
    getAuthConfig().then(setConfig).catch(() => setError('Could not reach the login service. Reload to try again.'));
  }, []);

  useEffect(() => {
    if (!config?.googleClientId || !googleButton.current) return;
    const render = () => {
      window.google.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: async ({ credential }) => {
          setBusy(true); setError('');
          try {
            await verifyGoogleToken(credential, mode);
            window.location.assign('/gallery');
          } catch (requestError) {
            setError(describeAuthError(requestError, 'login'));
            setBusy(false);
          }
        },
      });
      googleButton.current.innerHTML = '';
      window.google.accounts.id.renderButton(googleButton.current, { theme: 'outline', size: 'large', width: 280 });
    };
    if (window.google?.accounts?.id) { render(); return; }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = render;
    script.onerror = () => setError('Could not load Google sign-in.');
    document.head.appendChild(script);
    return () => { script.onload = null; script.onerror = null; };
  }, [config, mode]);

  const submit = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (mode === 'signup') await signupWithPassword(form.name, form.email, form.password);
      else await loginWithPassword(form.email, form.password);
      window.location.assign('/gallery');
    } catch (requestError) {
      setError(describeAuthError(requestError, mode));
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-theme"><ThemeToggle /></div>
      <div className="login-card">
        <img className="login-logo" src="/testmu-bi-logo-v2.png" alt="TestMu BI" />
        <h2>TestMu BI</h2>
        {/* The signup tab appears only where the server will actually accept a
            signup. Accounts are normally provisioned by an administrator, so
            offering "Create account" would be inviting people into a 403.
            Hiding it is presentation only — the server refuses either way. */}
        {config?.selfSignupEnabled && (
          <div className="login-mode-tabs">
            <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => { setMode('login'); setError(''); }}>Sign in</button>
            <button type="button" className={mode === 'signup' ? 'on' : ''} onClick={() => { setMode('signup'); setError(''); }}>Create account</button>
          </div>
        )}
        <p>{mode === 'login' ? 'Sign in to access your dashboards and saved views.' : 'Create an account before signing in.'}</p>
        <form className="login-form" onSubmit={submit}>
          {mode === 'signup' && <input type="text" autoComplete="name" placeholder="Full name" value={form.name}
            onChange={event => setForm({ ...form, name: event.target.value })} required />}
          <input type="email" autoComplete="email" placeholder="Work email" value={form.email}
            onChange={event => setForm({ ...form, email: event.target.value })} required />
          <input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            placeholder={mode === 'signup' ? 'Password (10+ characters)' : 'Password'} value={form.password}
            onChange={event => setForm({ ...form, password: event.target.value })} minLength={mode === 'signup' ? 10 : undefined} required />
          <button className="btn-primary" type="submit" disabled={busy}>
            {waking ? 'Starting the server…' : busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
          {/* Named, not just spun at. The wait is real and up to a minute, and
              a person who knows why will wait it out instead of retyping a
              password that was never wrong. */}
          {waking && <p className="login-waking" role="status">
            The server sleeps when idle and is starting up. This takes up to a minute the first time.
          </p>}
        </form>
        {config?.googleClientId && <div className="login-divider"><span>or</span></div>}
        {config?.googleClientId && <div ref={googleButton} aria-label="Sign in with Google" />}
        {error && <div role="alert" style={{ color: 'var(--red)', marginTop: 12, fontSize: 13 }}>{error}</div>}
      </div>
    </div>
  );
}
