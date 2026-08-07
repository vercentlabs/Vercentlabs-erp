/**
 * Content author registry — no invented individual experts. A truthful
 * organizational byline is used everywhere a resource needs an author (see
 * .claude/rules/landing-content.md and
 * docs/landing-redesign/phase-6/author-and-review-policy.md).
 */
export const CONTENT_AUTHORS = Object.freeze([
  {
    id: "vercentlabs-product-team",
    name: "Vercentlabs Product Team",
    role: "Product and implementation practitioners at Vercentlabs",
    bio: "Resources bylined to the Vercentlabs Product Team are written and reviewed by the people who build and implement the product — grounded in the real module, workflow, and platform documentation referenced throughout this site, not a marketing byline detached from the product.",
    verified: true,
  },
]);

export function getAuthor(id) {
  return CONTENT_AUTHORS.find((author) => author.id === id) || null;
}
