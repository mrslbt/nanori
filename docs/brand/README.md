# nanoru brand assets

Originals, unchanged:

- `nanoru-logo-original.png`: the supplied 1920 x 1280 wordmark on an opaque near-white canvas (the file's alpha channel is fully opaque).
- `nanoru-logo-64x64-original.png`: the supplied 64 x 64 version. The whole boxed wordmark at that size is not readable at 16 or 32 px, so it is not used as a favicon.

Derived from the original, no redrawing (the canvas was trimmed to the rectangle plus a 24 px margin, and the white background was turned into transparency by using the mark's darkness as alpha):

- `nanoru-logo-mark.png`: trimmed, transparent, black strokes, 1294 x 497. Use this for display.
- `nanoru-logo-mark-white.png`: trimmed, opaque white background.
- `nanoru-logo-readme.png` and `nanoru-logo-readme-dark.png`: 560 px wide (280 CSS px at 2x), black and off-white strokes, for the README in GitHub's light and dark appearance.
- `nanoru-logo-report.png`: 280 px wide (140 CSS px at 2x). Embedded as a data URI in every generated report by `src/report/logo.ts`; dark mode inverts only this image with CSS.

To regenerate `src/report/logo.ts` after replacing `nanoru-logo-report.png`: `node scripts/embed-logo.mjs`.
