# Landing-page design references

Public GitHub repositories reviewed on 2026-09-09 for the second design pass:

| Repository | Reference studied | Application in this project |
| --- | --- | --- |
| [Cruip / Open](https://github.com/cruip/open-react-template) | `components/hero-home.tsx`; product-led composition and substantial media framing | A large interactive workspace anchors the page. Used as a visual reference; no template source or assets were copied. The repository states GPL terms. |
| [Eldora SaaS template](https://github.com/karthikmudunuri/saas-landing-page-template) | `src/components/Hero.tsx`; spatial layering and expressive display typography | Dimensional data nodes, a physical screen treatment, and an asymmetric hero. Used as a visual reference; no source or assets copied. The repository states MIT terms. |
| [Magic UI](https://github.com/magicuidesign/magicui) | Animated Beam and Orbiting Circles component sources | Directional paths connect data, insight, and a live screen. Our illustration uses original SVG paths and short CSS animations, without adding Motion or Tailwind dependencies. The repository is MIT licensed. |

The references inform composition and motion; all landing-page components and illustrations are authored for TestMu BI. No template repositories are installed as runtime dependencies or attached as Git remotes.

## Typography

[Space Grotesk](https://github.com/google/fonts/tree/main/ofl/spacegrotesk) is self-hosted at `client/public/fonts/SpaceGrotesk-Variable.ttf`. Its SIL Open Font License is preserved beside it in `SpaceGrotesk-OFL.txt`. There are no third-party font requests at runtime.

## Product boundaries

The existing password and configured Google authentication flows are retained. The signed-out visualizations are explicitly sample data, and the query interaction is a guided demo. The landing page introduces no new data integrations or AI endpoint.
