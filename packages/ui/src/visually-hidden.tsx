import type { ReactNode } from 'react';

export interface VisuallyHiddenProps {
  children: ReactNode;
}

const visuallyHiddenStyle = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

/** Renders content available to assistive technology without a visible layout footprint. Supports SP032. */
export function VisuallyHidden({ children }: VisuallyHiddenProps) {
  return <span style={visuallyHiddenStyle}>{children}</span>;
}
