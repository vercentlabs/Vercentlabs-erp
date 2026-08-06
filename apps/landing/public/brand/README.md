# Brand assets — placeholder

No exported brand asset files (logo lockups, PNG/SVG exports at fixed sizes, brand
guidelines PDF) exist anywhere in the repository — the product's "V" mark is drawn
directly in CSS (`apps/web/src/app/globals.css`), not shipped as a reusable file.

`components/brand/logo.tsx` reproduces the same "V" letterform as a flat (non-gradient)
SVG, consistent with the Control Surface direction's "no gradients" rule, without
altering its proportions or inventing a new symbol. This is a functional placeholder,
not a final brand-approved asset — replace it here and re-point the component the
moment the design team provides real exported logo files (see
`docs/landing-redesign/phase-2/product-visual-guidelines.md`, "Known limitations").
