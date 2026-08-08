# Phase 7 Media Performance Audit

## Inventory (real, measured — every image file under `public/`)

| File | Intrinsic dimensions | File size |
|---|---|---|
| `product/accounting-dashboard.png` | 1440×900 | 129.1 KB |
| `product/assets-dashboard.png` | 1440×900 | 80.6 KB |
| `product/crm-leads-list.png` | 1440×1160 | 142.8 KB |
| `product/crm-pipeline-board.png` | 1440×900 | 127.9 KB |
| `product/hr-payroll-dashboard.png` | 1440×900 | 79.9 KB |
| `product/manufacturing-dashboard.png` | 1440×900 | 78.1 KB |
| `product/point-of-sale-dashboard.png` | 1440×900 | 77.2 KB |
| `product/procurement-orders-list.png` | 1440×900 | 82.7 KB |
| `product/projects-dashboard.png` | 1440×900 | 79.2 KB |
| `product/quality-dashboard.png` | 1440×900 | 80.4 KB |
| `product/sales-order-detail.png` | 1440×1290 | 109.9 KB |
| `product/sales-quotation-detail.png` | 1440×1364 | 120.9 KB |
| `product/stock-overview.png` | 1440×900 | 96.6 KB |
| `product/support-dashboard.png` | 1440×900 | 79.9 KB |
| `icons/icon.svg` | vector | 267 bytes |

**Total: 14 real product screenshots, ~1.35 MB combined, all PNG format, no duplicates.** No stock photography, no fake dashboard illustrations — every image is a real, annotated screenshot of the actual ERP product, consistent with the Control Surface creative direction's explicit requirement.

## Delivery pipeline (real, verified — not assumed)

Every screenshot renders through `components/product/product-frame.tsx`'s `ProductScreenshot` component using `next/image`, confirmed by reading the component directly:

```tsx
<Image
  src={screenshot.src}
  alt={screenshot.alt}
  width={screenshot.width}
  height={screenshot.height}
  className="h-auto w-full"
  sizes="(min-width: 1024px) 800px, 100vw"
/>
```

- **Responsive `sizes`:** present and correct — 800px on desktop (≥1024px), full viewport width on mobile. `next/image` uses this to serve an appropriately-sized variant rather than always shipping the full 1440px-wide source.
- **Format conversion:** automatic — `next.config.mjs`'s `images.formats: ["image/avif", "image/webp"]` means every screenshot is served as AVIF or WebP to supporting browsers, not the raw PNG, without any per-image code change needed.
- **Explicit dimensions:** every screenshot passes real `width`/`height` (from `lib/product/screenshots.ts`'s `getApprovedScreenshot()`), which is what allows `next/image` to reserve the correct aspect-ratio space before the image loads — this is the mechanism preventing screenshot-loading layout shift, consistent with this phase's CLS measurements (0 or near-0 on every route — see `baseline-measurements.md`).
- **Alt text:** every screenshot has a real, specific `alt` value sourced from the same approved-screenshot registry (not a generic "screenshot" placeholder) — confirmed by the existing unit test `"every approved screenshot is marked approvedForMarketing and resolves by id"`.

## Real finding: no screenshot sets `priority`

`ProductScreenshot` never passes `priority` to `next/image`, which means every screenshot — including the ones used as the primary hero image on module pages (`module-hero.tsx`) and platform pages (`platform-hero.tsx`), both clearly above-the-fold — uses `next/image`'s default lazy-loading behavior (`loading="lazy"`, IntersectionObserver-gated fetch start).

**This matters specifically because these are exactly the images most likely to be the LCP element** on the pages where they're used as the hero image. Lazy-loading an above-the-fold, likely-LCP image delays its fetch start until the browser confirms it's near the viewport — for a hero image that's *already* in the viewport on load, this adds unnecessary latency before the fetch even begins, directly working against LCP rather than helping it. `next/image`'s own documentation explicitly recommends `priority` for exactly this case (a known, above-the-fold LCP candidate).

This finding is corroborated by, but not proven by, this session's own real Lighthouse LCP-element data (see `core-web-vitals-audit.md` for the specific per-route LCP-element values) — where a route's LCP element is confirmed to be a screenshot, adding `priority` to that specific screenshot is the correctly-targeted fix; this audit does not recommend adding `priority` indiscriminately to every screenshot, since screenshots further down a page (e.g., in `product-evidence-section.tsx`'s secondary/supporting screenshots) are correctly lazy-loaded today and should stay that way — eagerly loading an off-screen image would only add unnecessary initial-load weight.

## Trade-off: readability over minimum bytes

At 1440px-wide source screenshots showing real dense ERP UI (data tables, form fields, dashboard widgets), aggressive compression or downscaling below what's needed for legible text in the screenshot would actively work against this site's own stated evidence-based positioning — these images exist specifically to prove real product capability, and an illegible screenshot undermines that purpose regardless of how fast it loads. The current ~77-143 KB range per screenshot (before AVIF/WebP conversion, which typically halves this further) is a reasonable balance: small enough not to dominate a route's byte weight (confirmed — no route's Lighthouse `total-byte-weight` audit flagged images as the dominant contributor), large enough that screenshot text remains genuinely readable at the 800px desktop display width. No screenshot was re-compressed or re-cropped this phase — the existing sizing was already appropriate.

## SVG

The single SVG (`icons/icon.svg`, 267 bytes) is negligible and not a performance concern.

## Conclusion

One real, targeted finding: add `priority` to `ProductScreenshot` specifically where a real Lighthouse run confirms the rendered screenshot is the route's actual LCP element (see `core-web-vitals-audit.md` for which routes qualify) — not indiscriminately. No other media finding warranted action; the existing `next/image` pipeline (responsive `sizes`, automatic format conversion, explicit dimensions, real alt text) was already correctly built in an earlier phase.
