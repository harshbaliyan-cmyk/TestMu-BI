import { useRef, useState } from 'react';
import { createTvLink } from '../lib/api';

// Mints a revocable share link for this board and puts the /tv/ URL on the
// clipboard. Each click creates a NEW token (the server only stores hashes, so
// an old link cannot be re-read) — links are listed and revoked from the
// Account page. Session-only by nature: the server refuses token management
// with a share token, so this button simply errors on a wall display and is
// hidden there anyway.
export default function CopyTvLinkButton({ templateId, customDashboardId, className }) {
  const [state, setState] = useState('idle'); // idle | copied | error
  const resetTimer = useRef(null);
  const create = async () => {
    try {
      const { token } = await createTvLink(customDashboardId ? { customDashboardId } : templateId);
      await navigator.clipboard.writeText(`${window.location.origin}/tv/${token}`);
      setState('copied');
    } catch {
      setState('error');
    }
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setState('idle'), 4000);
  };
  return <button className={className} onClick={create}
    title="Copies a link that opens this board on a TV with no sign-in. Revoke links from the Account page.">
    {state === 'copied' ? 'TV link copied ✓' : state === 'error' ? 'Could not create link' : 'Copy TV link'}
  </button>;
}
