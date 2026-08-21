import { useId } from 'react';

/* Podium artwork for the AE/AM performance rankings.
 *
 * The reference design hangs its whole personality on five sculpted award
 * badges — a laurel wreath for first, struck medals for second and third,
 * standalone numerals after that — sitting beside the percentage rather than
 * in front of the name. This draws them.
 *
 * Drawn, not fetched, for three reasons that all bite on a wall display:
 *
 *   - the mock hotlinked five Pinterest JPEGs. This board already refuses to
 *     hotlink (see LeaderAvatar): a TV with no route to a third-party CDN
 *     renders broken images, and every view leaks a request.
 *   - those JPEGs carry an opaque cream background. On the dark theme they
 *     would read as five white rectangles down the right edge of the card.
 *   - a badge is 68px on a laptop and ~170px on a 4K panel. Vector holds both;
 *     a 736px raster does not.
 *
 * Every metal comes from the --medal-* tokens, so the podium keeps the same
 * hues as the row tints behind it and follows the theme.
 */

const METAL = {
  1: 'var(--medal-gold)',
  2: 'var(--medal-silver)',
  3: 'var(--medal-bronze)',
};

// Ranks past the podium are steel rather than a fourth invented metal: the
// point of the artwork is that first, second and third are distinguishable
// across a room, and a shiny gold "4" (as the mock drew it) undoes that.
const STEEL = 'var(--txt-3)';

const lighten = (color, amount) => `color-mix(in srgb, ${color} ${100 - amount}%, #fff)`;
const darken = (color, amount) => `color-mix(in srgb, ${color} ${100 - amount}%, #000)`;

// One laurel branch, generated rather than hand-authored: leaves ride an arc of
// radius 30 about (50, 48), tapering towards the tip. The mirrored copy makes
// the wreath, so the two halves cannot drift apart.
const LEAF_COUNT = 7;
const LAUREL_LEAVES = Array.from({ length: LEAF_COUNT }, (_, index) => {
  const t = index / (LEAF_COUNT - 1);
  const angle = 143 + t * 112;
  const radians = (angle * Math.PI) / 180;
  return {
    x: 50 + 30 * Math.cos(radians),
    y: 48 + 30 * Math.sin(radians),
    rx: 9.6 - t * 3.9,
    ry: 4.7 - t * 1.6,
    // The leaf runs along the branch (tangent = angle + 90) and cants outward
    // by 25°, which is what stops the wreath reading as a ring of pills.
    rotate: angle + 65,
  };
});

const LAUREL_START = LAUREL_LEAVES[0];
const LAUREL_END = LAUREL_LEAVES[LEAF_COUNT - 1];

function LaurelBranch({ fill, stem }) {
  return (
    <g>
      <path
        d={`M ${LAUREL_START.x.toFixed(2)} ${LAUREL_START.y.toFixed(2)} A 30 30 0 0 1 ${LAUREL_END.x.toFixed(2)} ${LAUREL_END.y.toFixed(2)}`}
        fill="none" stroke={stem} strokeWidth="2.4" strokeLinecap="round"
      />
      {LAUREL_LEAVES.map((leaf, index) => (
        <ellipse
          key={index}
          cx={leaf.x} cy={leaf.y} rx={leaf.rx} ry={leaf.ry}
          fill={fill}
          transform={`rotate(${leaf.rotate.toFixed(2)} ${leaf.x.toFixed(2)} ${leaf.y.toFixed(2)})`}
        />
      ))}
    </g>
  );
}

export default function RankBadge({ rank, className = '' }) {
  const uid = useId().replace(/:/g, '');
  const metal = METAL[rank] || STEEL;
  const face = `${uid}-face`;
  const rim = `${uid}-rim`;
  const struck = `${uid}-struck`;

  const numeral = (y, size) => (
    <text
      x="50" y={y} textAnchor="middle" dominantBaseline="central"
      fontFamily="inherit" fontSize={size} fontWeight="800"
      letterSpacing="-1" fill={`url(#${face})`}
      stroke={darken(metal, 52)} strokeWidth="1.5" paintOrder="stroke"
    >{rank}</text>
  );

  return (
    <svg
      className={`ae-rank-badge${className ? ` ${className}` : ''}`}
      viewBox="0 0 100 100" role="img" aria-label={`Rank ${rank}`}
    >
      <defs>
        {/* Top-lit, so the badges catch light the same way the row surfaces do. */}
        <linearGradient id={face} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" style={{ stopColor: lighten(metal, 42) }} />
          <stop offset="0.42" style={{ stopColor: metal }} />
          <stop offset="1" style={{ stopColor: darken(metal, 30) }} />
        </linearGradient>
        <linearGradient id={rim} x1="0" y1="1" x2="0.3" y2="0">
          <stop offset="0" style={{ stopColor: lighten(metal, 30) }} />
          <stop offset="1" style={{ stopColor: darken(metal, 22) }} />
        </linearGradient>
        {/* The struck face of the disc. It has to sit DARKER than the numeral
            on top of it: the first cut used the same gradient for both, and a
            metal numeral on a metal field of the same value is unreadable at
            the size a badge actually renders. */}
        <linearGradient id={struck} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" style={{ stopColor: darken(metal, 18) }} />
          <stop offset="1" style={{ stopColor: darken(metal, 44) }} />
        </linearGradient>
      </defs>

      {rank === 1 && <>
        <LaurelBranch fill={`url(#${face})`} stem={darken(metal, 30)} />
        <g transform="translate(100 0) scale(-1 1)">
          <LaurelBranch fill={`url(#${face})`} stem={darken(metal, 30)} />
        </g>
        {/* Award ribbon closing the wreath. Notched ends so it reads as cloth
            rather than as a label bar. */}
        <path
          d="M 17 73 L 50 67 L 83 73 L 83 88 L 68 82 L 50 87 L 32 82 L 17 88 Z"
          fill={`url(#${rim})`} stroke={darken(metal, 42)} strokeWidth="1.2" strokeLinejoin="round"
        />
        {numeral(46, 40)}
      </>}

      {(rank === 2 || rank === 3) && <>
        {/* Ribbon tails stay in the medal's own metal rather than the mock's
            red: on this board red already means "at risk", and a decorative
            one beside an attainment bar would be the only red that isn't. */}
        <path d="M 35 48 L 52 48 L 47 92 L 25 84 Z" fill={darken(metal, 40)} />
        <path d="M 65 48 L 48 48 L 53 92 L 75 84 Z" fill={darken(metal, 26)} />
        <circle cx="50" cy="41" r="29" fill={`url(#${rim})`} />
        <circle cx="50" cy="41" r="23" fill={`url(#${struck})`} />
        {numeral(41, 30)}
      </>}

      {/* A bare numeral has no wreath or disc to fill the frame, so it is set
          larger than the ones struck into the medals — otherwise rank four
          reads as a smaller thing rather than a plainer one. */}
      {rank > 3 && numeral(50, 64)}
    </svg>
  );
}
