import { useEffect, useId, useRef, useState } from 'react';
import { getAuthConfig, loginWithPassword, onApiWaking, signupWithPassword, verifyGoogleToken } from '../lib/api';
import ThemeToggle from '../components/ThemeToggle';
import './Login.css';

// Share the optional SDK load across StrictMode mounts and account-mode changes.
let googleIdentityLoad;
function loadGoogleIdentity() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!googleIdentityLoad) {
    googleIdentityLoad = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => { script.remove(); googleIdentityLoad = undefined; reject(new Error('Google sign-in unavailable')); };
      document.head.appendChild(script);
    });
  }
  return googleIdentityLoad;
}

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

// `embedded` renders the shared form inside the landing's access sheet: the
// fixed theme toggle and the brand block belong to the page around it there.
// Everything that talks to the server is shared, so the hero form and the
// bare /login form cannot drift apart.
export default function Login({ embedded = false, initialMode = 'login' } = {}) {
  const googleButton = useRef(null);
  const firstField = useRef(null);
  const modeInitialized = useRef(false);
  const submitting = useRef(false);
  const id = useId();
  const [config, setConfig] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [success, setSuccess] = useState('');
  const [configFailed, setConfigFailed] = useState(false);
  // The API sleeps on Render's free plan and takes most of a minute to wake.
  // Without saying so, that wait looks like a hung button and the failure that
  // follows looks like a wrong password.
  const [waking, setWaking] = useState(false);
  useEffect(() => onApiWaking(setWaking), []);

  const loadConfig = () => {
    setConfigFailed(false); setError('');
    return getAuthConfig().then(setConfig).catch(() => {
      setConfigFailed(true);
      setError('Could not reach the login service. Try again in a moment.');
    });
  };
  useEffect(() => { loadConfig(); }, []);
  useEffect(() => {
    if (!config || modeInitialized.current) return;
    modeInitialized.current = true;
    setMode(initialMode === 'signup' && config.selfSignupEnabled ? 'signup' : 'login');
  }, [config, initialMode]);
  useEffect(() => {
    if (embedded) firstField.current?.focus();
  }, [embedded, mode, config]);

  const completeAuth = result => {
    if (result?.pending) {
      setSuccess(result.message || 'Check your email to finish setting up this account.');
      setBusy(false);
      submitting.current = false;
      return;
    }
    setSuccess('You’re in. Opening your workspace…');
    window.location.assign('/gallery');
  };

  useEffect(() => {
    if (!config?.googleClientId || !googleButton.current) return;
    let active = true;
    const render = () => {
      if (!active || !googleButton.current) return;
      window.google.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: async ({ credential }) => {
          if (!active || submitting.current) return;
          submitting.current = true;
          setBusy(true); setError(''); setSuccess('');
          try {
            const result = await verifyGoogleToken(credential, mode);
            completeAuth(result);
          } catch (requestError) {
            setError(describeAuthError(requestError, 'login'));
            setBusy(false);
            submitting.current = false;
          }
        },
      });
      googleButton.current.innerHTML = '';
      const width = Math.max(200, Math.min(320, googleButton.current.clientWidth || 280));
      window.google.accounts.id.renderButton(googleButton.current, { theme: 'outline', size: 'large', width });
    };
    loadGoogleIdentity().then(render).catch(() => { if (active) setError('Could not load Google sign-in. You can still use your password.'); });
    return () => { active = false; };
  }, [config, mode]);

  const submit = async event => {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setError(''); setSuccess('');
    try {
      const result = mode === 'signup'
        ? await signupWithPassword(form.name, form.email, form.password)
        : await loginWithPassword(form.email, form.password);
      completeAuth(result);
    } catch (requestError) {
      setError(describeAuthError(requestError, mode));
      setBusy(false);
      submitting.current = false;
    }
  };

  const card = (
      <div className="login-card" id={embedded ? "signin" : undefined}>
        {!embedded && <img className="login-logo" src="/testmu-bi-logo-v3.png" alt="TestMu BI" />}
        <h2>{embedded ? (mode === 'signup' ? 'Make room for clarity.' : 'Welcome back.') : 'TestMu BI'}</h2>
        {/* The signup tab appears only where the server will actually accept a
            signup. Accounts are normally provisioned by an administrator, so
            offering "Create account" would be inviting people into a 403.
            Hiding it is presentation only — the server refuses either way. */}
        {config?.selfSignupEnabled && (
          <div className="login-mode-tabs" role="group" aria-label="Account access">
            <button type="button" disabled={busy} aria-pressed={mode === 'login'} className={mode === 'login' ? 'on' : ''} onClick={() => { setMode('login'); setError(''); setSuccess(''); setShowPassword(false); }}>Sign in</button>
            <button type="button" disabled={busy} aria-pressed={mode === 'signup'} className={mode === 'signup' ? 'on' : ''} onClick={() => { setMode('signup'); setError(''); setSuccess(''); setShowPassword(false); }}>Create account</button>
          </div>
        )}
        <p>{mode === 'signup' ? 'Your data. Your workspace. Your perspective.' : config && !config.selfSignupEnabled ? 'Sign in with the work account invited by your admin.' : 'Your boards are right where you left them.'}</p>
        <form className="login-form" onSubmit={submit} aria-busy={busy} aria-describedby={error ? `${id}-error` : undefined}>
          <fieldset disabled={busy || !config}>
          {mode === 'signup' && <label className="login-field">Full name<input ref={firstField} name="name" type="text" autoComplete="name" placeholder="Full name" value={form.name}
            onChange={event => setForm({ ...form, name: event.target.value })} required /></label>}
          <label className="login-field">Work email<input ref={mode === 'login' ? firstField : undefined} name="email" type="email" autoComplete="email" placeholder="Work email" value={form.email}
            onChange={event => setForm({ ...form, email: event.target.value })} required /></label>
          <label className="login-field" htmlFor={`${id}-password`}>Password</label>
          <div className="login-password-wrap"><input id={`${id}-password`} name="password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            placeholder={mode === 'signup' ? 'Password (12+ characters)' : 'Password'} value={form.password}
            aria-describedby={mode === 'signup' ? `${id}-hint` : undefined}
            onChange={event => setForm({ ...form, password: event.target.value })} minLength={mode === 'signup' ? 12 : undefined} required />
            <button type="button" className="login-password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(v => !v)}>{showPassword ? 'Hide' : 'Show'}</button>
          </div>
          {mode === 'signup' && <small className="login-password-hint" id={`${id}-hint`}>At least 12 characters.</small>}
          <button className="btn-primary" type="submit" disabled={busy || !config}>
            {busy && <span className="login-loading" aria-hidden="true"><i /><i /><i /></span>}
            {waking ? 'Starting the server…' : busy ? 'Please wait…' : !config ? 'Connecting…' : mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
          </fieldset>
          {/* Named, not just spun at. The wait is real and up to a minute, and
              a person who knows why will wait it out instead of retyping a
              password that was never wrong. */}
          {waking && <p className="login-waking" role="status">
            The server sleeps when idle and is starting up. This takes up to a minute the first time.
          </p>}
        </form>
        {config?.googleClientId && <div className="login-divider"><span>or</span></div>}
        {config?.googleClientId && <div ref={googleButton} className="login-google" inert={busy ? '' : undefined} aria-label="Sign in with Google" />}
        {success && <div className="login-success" role="status">{success}</div>}
        {error && <div className="login-error" id={`${id}-error`} role="alert">{error}</div>}
        {configFailed && <button className="login-retry" type="button" onClick={loadConfig}>Try again</button>}
      </div>
  );
  if (embedded) return card;
  return (
    <div className="login-wrap">
      <div className="login-theme"><ThemeToggle /></div>
      {card}
    </div>
  );
}
