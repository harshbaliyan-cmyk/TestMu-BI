import { useEffect, useState } from 'react';

// Everything a wall display needs that a desk browser does not.
//
// A TV runs unattended: nobody presses refresh, nobody notices the Wi-Fi
// dropping, and the OS happily blanks the screen mid-standup. Left alone, the
// presentation pages showed whatever the data looked like at the moment they
// were opened — forever, with no hint of how old it was.
//
//   - refreshTick: bumps every intervalSeconds, on network reconnect, and when
//     the page becomes visible again. Pages add it to their fetch effect's
//     dependencies so the numbers on screen can never silently freeze.
//   - markFresh(): pages call it after a successful fetch. dataUpdatedAt is
//     the visible proof the screen is live — a stamp that stops advancing is
//     the signal to stop trusting the wall.
//   - online: false while the network is down, so the header can say so
//     instead of letting the audience read stale figures as current.
//   - screen wake lock: requested up front and re-acquired whenever the page
//     becomes visible, because the browser silently releases it on tab switch
//     and display sleep. Denial (battery saver, unsupported browser) is not an
//     error — the display's own sleep settings simply stay in charge.
export function usePresentationLiveness({ intervalSeconds = 60 } = {}) {
  const [refreshTick, setRefreshTick] = useState(0);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [dataUpdatedAt, setDataUpdatedAt] = useState(null);

  useEffect(() => {
    const timer = setInterval(() => setRefreshTick(t => t + 1), Math.max(15, intervalSeconds) * 1000);
    return () => clearInterval(timer);
  }, [intervalSeconds]);

  useEffect(() => {
    // Reconnecting refetches immediately rather than waiting out the interval:
    // after an outage the screen is by definition stale.
    const onOnline = () => { setOnline(true); setRefreshTick(t => t + 1); };
    const onOffline = () => setOnline(false);
    const onVisible = () => { if (document.visibilityState === 'visible') setRefreshTick(t => t + 1); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    if (!navigator.wakeLock?.request) return;
    let lock = null;
    let unmounted = false;
    const acquire = () => navigator.wakeLock.request('screen')
      .then(acquired => {
        if (unmounted) acquired.release().catch(() => {});
        else lock = acquired;
      })
      .catch(() => {});
    acquire();
    const reacquire = () => { if (document.visibilityState === 'visible') acquire(); };
    document.addEventListener('visibilitychange', reacquire);
    return () => {
      unmounted = true;
      document.removeEventListener('visibilitychange', reacquire);
      lock?.release().catch(() => {});
    };
  }, []);

  return { refreshTick, online, dataUpdatedAt, markFresh: () => setDataUpdatedAt(new Date()) };
}
