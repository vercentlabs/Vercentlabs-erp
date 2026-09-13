'use client';

import { useEffect } from 'react';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main role="alert">
      <h1>Something went wrong</h1>
      <p>An unexpected error occurred while loading this page.</p>
      <button type="button" onClick={() => reset()}>
        Try again
      </button>
    </main>
  );
}
