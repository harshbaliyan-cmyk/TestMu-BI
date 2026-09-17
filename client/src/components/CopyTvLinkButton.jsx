import { useRef, useState } from 'react';
import { createTvLink } from '../lib/api';

// Mints a revocable share link for this board and puts the /tv/ URL on the
// clipboard. Each click creates a NEW token (the server only stores hashes, so
// an old link cannot be re-read) — links are listed and revoked from the
// Account page. Session-only by nature: the server refuses token management
// with a share token, so this button simply errors on a wall display and is
// hidden there anyway.
export default function CopyTvLinkButton({ templateId, className }) {
  const [state, setState] = useState('idle'); // idle | copied | error
  const resetTimer = useRef(null);
  const create = async () => {
    let url = null;
    try {
      const { token } = await createTvLink(templateId);
      url = `${window.location.origin}/tv/${token}`;
    } catch {
      setState('error');
    }
    if (url) {
      // The token exists from here on and cannot be re-read, so a clipboard
      // refusal (plain http on a LAN address, permission denied) must still
      // hand the link over rather than report a failure that leaves an
      // orphan link active in the Account list.
      try { await navigator.clipboard.writeText(url); setState('copied'); }
      catch { window.prompt('Copy this TV link:', url); setState('copied'); }
    }
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setState('idle'), 4000);
  };
  return <button className={className} onClick={create}
    title="Copies a link that opens this board on a TV with no sign-in. Revoke links from the Account page.">
    {state === 'copied' ? 'TV link copied ✓' : state === 'error' ? 'Could not create link' : 'Copy TV link'}
  </button>;
}
