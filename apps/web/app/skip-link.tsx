'use client';

import type { MouseEvent } from 'react';

/**
 * Native browser focus-follows-fragment behavior for a `tabindex="-1"`
 * target is inconsistent (does not reliably move focus in Chromium), so
 * this manages focus explicitly - the standard, accessible pattern for
 * reliable skip links.
 */
export function SkipLink() {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const target = document.getElementById('main-content');
    if (!target) return;
    target.focus();
    target.scrollIntoView();
    window.history.pushState(null, '', '#main-content');
  };

  return (
    <a className="skip-link" href="#main-content" onClick={handleClick}>
      Skip to main content
    </a>
  );
}
