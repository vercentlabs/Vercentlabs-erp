"use client";
export default function LeadSourcesError({ reset }: { reset: () => void }) {
  return (
    <div className="empty-state">
      <h1>Lead sources could not be loaded</h1>
      <p>Retry the request. No configuration was changed.</p>
      <button className="primary-button" type="button" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
