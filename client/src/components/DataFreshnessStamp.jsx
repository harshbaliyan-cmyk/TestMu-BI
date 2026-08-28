// The header stamp every presentation page renders beside the clock. One
// component rather than five copies, so "how staleness is communicated" stays
// a single decision. A stamp that stops advancing — or flips to offline — is
// the audience's cue to stop trusting the wall.
export default function DataFreshnessStamp({ online, dataUpdatedAt }) {
  const text = !online
    ? 'Offline — will refresh on reconnect'
    : dataUpdatedAt
      ? `Data updated ${dataUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : 'Loading data…';
  return <span className={`presentation-data-stamp${online ? '' : ' is-offline'}`}>{text}</span>;
}
