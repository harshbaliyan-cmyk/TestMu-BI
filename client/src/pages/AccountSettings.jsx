import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  changePassword, listUsers, inviteUser, updateUserAccess, resetUserPassword,
  deleteMyAccount, deleteUser,
} from '../lib/api';
import ThemeToggle from '../components/ThemeToggle';
import { useAuth } from '../hooks/useAuth';

const shortDate = value => (value ? new Date(value).toLocaleDateString() : '—');

// Shown once, never retrievable again — the server keeps only a bcrypt hash.
// Framed as a hand-off step rather than a value to leave sitting on screen.
function OneTimeSecret({ label, value, onDismiss }) {
  const [copied, setCopied] = useState(false);
  return <div className="account-secret" role="alert">
    <div>
      <b>{label}</b>
      <p>Shown once. Give it to them over a channel you trust, then have them change it at first sign-in.</p>
      <code>{value}</code>
    </div>
    <div className="account-secret-actions">
      <button type="button" className="btn-secondary" onClick={() => {
        navigator.clipboard?.writeText(value).then(() => setCopied(true)).catch(() => {});
      }}>{copied ? 'Copied' : 'Copy'}</button>
      <button type="button" className="btn-primary" onClick={onDismiss}>Done</button>
    </div>
  </div>;
}

function ChangePasswordCard({ user, forced }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [state, setState] = useState({ busy: false, error: '', success: '' });

  const submit = async event => {
    event.preventDefault();
    if (form.newPassword !== form.confirm) {
      return setState({ busy: false, error: 'The two new passwords do not match', success: '' });
    }
    setState({ busy: true, error: '', success: '' });
    try {
      const result = await changePassword(form.currentPassword, form.newPassword);
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      setState({ busy: false, error: '',
        success: result.otherSessionsSignedOut
          ? `Password updated. ${result.otherSessionsSignedOut} other session${result.otherSessionsSignedOut === 1 ? '' : 's'} signed out.`
          : 'Password updated.' });
      if (forced) setTimeout(() => window.location.assign('/gallery'), 900);
    } catch (error) {
      setState({ busy: false, error: error.response?.data?.error || 'Could not change the password', success: '' });
    }
  };

  return <section className="card account-card">
    <h3>Change password</h3>
    <p className="hint">
      Changing your password signs out every other session on your account — that is the point of
      changing it if you think someone else has it.
    </p>
    <form className="account-form" onSubmit={submit}>
      <label><span>Current password</span>
        <input type="password" autoComplete="current-password" value={form.currentPassword}
          onChange={e => setForm({ ...form, currentPassword: e.target.value })} required />
      </label>
      <label><span>New password</span>
        <input type="password" autoComplete="new-password" value={form.newPassword}
          onChange={e => setForm({ ...form, newPassword: e.target.value })} required minLength={12} />
      </label>
      <label><span>Confirm new password</span>
        <input type="password" autoComplete="new-password" value={form.confirm}
          onChange={e => setForm({ ...form, confirm: e.target.value })} required minLength={12} />
      </label>
      <p className="hint">
        At least 12 characters. Either mix three of lowercase, uppercase, numbers and symbols, or use
        16+ characters — a long passphrase is easier to remember and harder to guess.
      </p>
      <button className="btn-primary" type="submit" disabled={state.busy}>
        {state.busy ? 'Saving…' : 'Update password'}
      </button>
      {state.error && <div className="account-error" role="alert">{state.error}</div>}
      {state.success && <div className="account-success" role="status">{state.success}</div>}
    </form>
  </section>;
}

function UsersCard({ me }) {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [secret, setSecret] = useState(null);
  const [invite, setInvite] = useState({ name: '', email: '', role: 'user', open: false });

  const load = () => listUsers().then(setUsers).catch(e => setError(e.response?.data?.error || 'Could not load users'));
  useEffect(() => { load(); }, []);

  const act = async (id, fn) => {
    setBusyId(id); setError('');
    try { await fn(); await load(); }
    catch (e) { setError(e.response?.data?.error || 'That change was refused'); }
    finally { setBusyId(''); }
  };

  const submitInvite = async event => {
    event.preventDefault();
    setError('');
    try {
      const result = await inviteUser({ name: invite.name, email: invite.email, role: invite.role });
      setSecret({ label: `Temporary password for ${result.user.email}`, value: result.temporaryPassword });
      setInvite({ name: '', email: '', role: 'user', open: false });
      await load();
    } catch (e) { setError(e.response?.data?.error || 'Could not create the account'); }
  };

  return <section className="card account-card">
    <div className="account-card-head">
      <div>
        <h3>Team</h3>
        <p className="hint">Everyone who can sign in. Each person sees only the data sources they connect.</p>
      </div>
      <button type="button" className="btn-primary" onClick={() => setInvite({ ...invite, open: !invite.open })}>
        {invite.open ? 'Cancel' : 'Add person'}
      </button>
    </div>

    {invite.open && <form className="account-form account-invite" onSubmit={submitInvite}>
      <label><span>Full name</span>
        <input value={invite.name} onChange={e => setInvite({ ...invite, name: e.target.value })} required minLength={2} />
      </label>
      <label><span>Work email</span>
        <input type="email" value={invite.email} onChange={e => setInvite({ ...invite, email: e.target.value })} required />
      </label>
      <label><span>Role</span>
        <select value={invite.role} onChange={e => setInvite({ ...invite, role: e.target.value })}>
          <option value="user">User — dashboards and their own data sources</option>
          <option value="admin">Admin — also manages people and audit logs</option>
        </select>
      </label>
      <button className="btn-primary" type="submit">Create account</button>
    </form>}

    {secret && <OneTimeSecret {...secret} onDismiss={() => setSecret(null)} />}
    {error && <div className="account-error" role="alert">{error}</div>}

    <div className="account-table-scroll">
      <table className="account-table">
        <thead><tr>
          <th>Person</th><th>Role</th><th>Status</th><th>Last sign-in</th><th aria-label="Actions" />
        </tr></thead>
        <tbody>
          {users.map(user => {
            const self = user.id === me?.id;
            const busy = busyId === user.id;
            return <tr key={user.id} className={user.status === 'disabled' ? 'is-disabled' : ''}>
              <td>
                <b>{user.displayName || '—'}</b>
                <span>{user.email}</span>
                {user.mustChangePassword && <em className="account-flag">must set a new password</em>}
              </td>
              <td>
                <select value={user.role} disabled={self || busy}
                  title={self ? 'You cannot change your own role' : undefined}
                  onChange={e => act(user.id, () => updateUserAccess(user.id, { role: e.target.value }))}>
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </td>
              <td><span className={`account-pill ${user.status}`}>{user.status}</span></td>
              <td>{shortDate(user.lastLoginAt)}</td>
              <td className="account-row-actions">
                <button type="button" className="btn-secondary" disabled={busy}
                  onClick={() => act(user.id, async () => {
                    const result = await resetUserPassword(user.id);
                    setSecret({ label: `Temporary password for ${user.email}`, value: result.temporaryPassword });
                  })}>Reset password</button>
                <button type="button" className="btn-secondary" disabled={self || busy}
                  title={self ? 'You cannot disable your own account' : undefined}
                  onClick={() => act(user.id, () => updateUserAccess(user.id, {
                    status: user.status === 'active' ? 'disabled' : 'active',
                  }))}>{user.status === 'active' ? 'Disable' : 'Enable'}</button>
                <button type="button" className="btn-danger" disabled={self || busy}
                  title={self ? 'Delete your own account below' : undefined}
                  onClick={() => {
                    if (window.confirm(`Delete ${user.email}? Their connected sources transfer to you. This cannot be undone.`)) {
                      act(user.id, () => deleteUser(user.id));
                    }
                  }}>Remove</button>
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  </section>;
}

// Deliberately slow to trigger: typing the address is a conscious act in a way
// that clicking "yes" is not, and the password check means a hijacked session
// cannot destroy the account.
function DeleteAccountCard({ user }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ confirmEmail: '', currentPassword: '' });
  const [state, setState] = useState({ busy: false, error: '' });

  const submit = async event => {
    event.preventDefault();
    setState({ busy: true, error: '' });
    try {
      await deleteMyAccount(form.confirmEmail, form.currentPassword);
      window.location.assign('/');
    } catch (error) {
      setState({ busy: false, error: error.response?.data?.error || 'Could not delete the account' });
    }
  };

  return <section className="card account-card account-danger">
    <h3>Delete account</h3>
    <p className="hint">
      Removes your sign-in details, saved views, dashboard preferences and connected sources.
      Security and access logs are kept but stripped of anything identifying you — they record that
      something happened, not who you are. This cannot be undone.
    </p>
    {!open
      ? <button type="button" className="btn-danger" onClick={() => setOpen(true)}>Delete my account</button>
      : <form className="account-form" onSubmit={submit}>
          <label><span>Type <b>{user.email}</b> to confirm</span>
            <input value={form.confirmEmail} autoComplete="off"
              onChange={e => setForm({ ...form, confirmEmail: e.target.value })} required />
          </label>
          <label><span>Current password</span>
            <input type="password" autoComplete="current-password" value={form.currentPassword}
              onChange={e => setForm({ ...form, currentPassword: e.target.value })} required />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn-danger" disabled={state.busy}>
              {state.busy ? 'Deleting…' : 'Permanently delete'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
          </div>
          {state.error && <div className="account-error" role="alert">{state.error}</div>}
        </form>}
  </section>;
}

export default function AccountSettings({ user }) {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const forced = Boolean(user?.mustChangePassword);

  return <div className="wrap account-wrap">
    <div className="top-nav" style={{ margin: '-18px -18px 18px' }}>
      <div className="brand" onClick={() => !forced && navigate('/gallery')} style={{ cursor: forced ? 'default' : 'pointer' }}>
        <img className="brand-logo" src="/testmu-bi-logo-v2.png" alt="TestMu BI" /><span>TestMu BI</span>
      </div>
      <div className="user-pill"><ThemeToggle /><span>{user?.name || 'User'}</span>
        <button className="btn-secondary" onClick={signOut}>Sign out</button></div>
    </div>

    <header className="top"><div className="top-row"><div>
      <h1>Account</h1>
      <div className="sub">{forced
        ? 'Choose your own password before continuing — the one you were given is temporary.'
        : 'Your sign-in details, and who else can reach this workspace.'}</div>
    </div>
      {!forced && <button type="button" className="btn-secondary" onClick={() => navigate('/gallery')}>Back to dashboards</button>}
    </div></header>

    <ChangePasswordCard user={user} forced={forced} />
    {user?.role === 'admin' && !forced && <UsersCard me={user} />}
    {!forced && <DeleteAccountCard user={user} />}
  </div>;
}
