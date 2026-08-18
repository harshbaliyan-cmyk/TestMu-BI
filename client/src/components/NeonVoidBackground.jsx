/**
 * Lightweight presentation-deck backdrop.
 *
 * This deliberately uses ordinary DOM + CSS instead of a continuously
 * rendered WebGL scene.  The three "slide masters" cross-fade slowly, which
 * keeps the page dimensional without running a render loop on the GPU.
 */
export default function NeonVoidBackground() {
  return (
    <div className="neon-void-bg deck-backdrop" aria-hidden="true">
      <div className="deck-slide deck-slide-one">
        <i className="deck-shape deck-orb" />
        <i className="deck-shape deck-panel" />
        <i className="deck-shape deck-line" />
      </div>
      <div className="deck-slide deck-slide-two">
        <i className="deck-shape deck-ring" />
        <i className="deck-shape deck-square" />
        <i className="deck-shape deck-dot" />
      </div>
      <div className="deck-slide deck-slide-three">
        <i className="deck-shape deck-arc" />
        <i className="deck-shape deck-ribbon" />
      </div>
      <div className="deck-noise" />
    </div>
  );
}
