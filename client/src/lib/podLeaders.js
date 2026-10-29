// Supplied sales-ops assignments. Photos are local so the dashboard and a
// signed-out TV can load them without depending on a third-party session.
export const POD_LEADERS = {
  'EMEA AE': { name: 'Saif Rizvi', photo: '/pod-leaders/saif-rizvi.webp' },
  'AMER AE II': { name: 'Misbah Farooqi', photo: '/pod-leaders/misbah-farooqi.webp' },
  'APAC AE': { name: 'Karan Rana', photo: '/pod-leaders/karan-rana.webp' },
  'AMER AE III': { name: 'Mohit Juneja', photo: '/pod-leaders/mohit-juneja.webp' },
  'AMER AE Corp': { name: 'Misbah Farooqi', photo: '/pod-leaders/misbah-farooqi.webp' },
  GCC: { name: 'Saif Rizvi', photo: '/pod-leaders/saif-rizvi.webp' },
  'AMER AM': { name: 'Prakhar Goyal', photo: '/pod-leaders/prakhar-goyal.webp' },
  'APAC AM': { name: 'Karan Rana', photo: '/pod-leaders/karan-rana.webp' },
  'EMEA AM': { name: 'Rishabh Agarwal', photo: '/pod-leaders/rishabh-agarwal.webp' },
};

const normalize = label => String(label || '').normalize('NFKC').trim().toUpperCase().replace(/[\s_-]+/g, ' ');
// Only known names are aliases. In particular, AMER I and an unqualified
// "AMER" must not silently inherit another team's leader.
const ALIASES = {
  'AMER II': 'AMER AE II', 'AE AMER II': 'AMER AE II',
  'AMER III': 'AMER AE III', 'AE AMER III': 'AMER AE III',
  'AMER CORP': 'AMER AE Corp', 'AE AMER CORP': 'AMER AE Corp',
  'AE EMEA': 'EMEA AE', 'AE APAC': 'APAC AE',
  'AE GCC': 'GCC', 'GCC AE': 'GCC',
  'AM AMER': 'AMER AM', 'AM APAC': 'APAC AM', 'AM EMEA': 'EMEA AM',
};
const known = new Map(Object.entries(POD_LEADERS).map(([key, value]) => [normalize(key), value]));
for (const [alias, canonical] of Object.entries(ALIASES)) known.set(normalize(alias), POD_LEADERS[canonical]);

export const getPodLeader = label => known.get(normalize(label)) || null;
