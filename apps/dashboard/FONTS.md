# Portal fonts

The portal self-hosts the two brand typefaces so that a page load never calls Google Fonts (a health-data
portal should not leak page views to a third party). The files live in `public/fonts/` and are served by
the API under `/portal/fonts/`; `src/styles/dashboard.css` declares the `@font-face` rules with the same
family names the design-system tokens use (`--bp-font-sans: 'Montserrat'`, `--bp-font-mono: 'JetBrains Mono'`),
so `tokens.css` is untouched.

| Family | Files | Weights | Licence |
| --- | --- | --- | --- |
| Montserrat (variable) | `montserrat-{latin,latin-ext,cyrillic,cyrillic-ext,vietnamese}.woff2` | 400–700 | `OFL-Montserrat.txt` |
| JetBrains Mono (variable) | `jetbrains-mono-{latin,latin-ext,greek,cyrillic,cyrillic-ext,vietnamese}.woff2` | 400–500 | `OFL-JetBrainsMono.txt` |

Each file is one script subset with its `unicode-range`, so a browser downloads only the subsets a page uses
(about 67 KB for Latin text). The website in `drive/` still loads the same families from Google Fonts; the
`platform/` API therefore serves a portal-specific Content-Security-Policy whose `font-src` is `'self'`
(`apps/api/src/http/app.ts`, `portalCsp`).

## Source

Downloaded once on 22 October 2026 from the Google Fonts CSS API (`fonts.googleapis.com/css2`,
`Montserrat:wght@400..700` and `JetBrains+Mono:wght@400..500`, woff2 as served to Chrome 130):
Montserrat v31 and JetBrains Mono v24. Both are licensed under the SIL Open Font License 1.1; the licence
texts next to the files come from `github.com/google/fonts` (`ofl/montserrat/OFL.txt`,
`ofl/jetbrainsmono/OFL.txt`).

To refresh: fetch the two CSS responses with a current Chrome user agent, download each `url(...)` into
`public/fonts/` under the `<family>-<subset>.woff2` names, and update the `unicode-range` lines in
`dashboard.css` if they changed. No build step and no third-party service are involved.
