"use client";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="system-state">
      <div className="system-icon">!</div>
      <h1>This page could not be displayed</h1>
      <p>
        Try loading the page again. No business action should be assumed
        complete until a success message is shown.
      </p>
      <button className="primary-button" type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
