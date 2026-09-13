import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SkipLink } from './skip-link.js';
import './globals.css';

export const metadata: Metadata = {
  title: 'Vercentlabs ERP',
  description: 'Vercentlabs ERP V2 engineering foundation.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SkipLink />
        {/* tabIndex={-1}: makes this a valid keyboard-focus target for the skip
            link above (a plain div is not focusable by default). */}
        <div id="main-content" tabIndex={-1}>
          {children}
        </div>
      </body>
    </html>
  );
}
