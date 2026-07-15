export default function Loading() {
  return (
    <main className="workspace-loading" aria-busy="true" aria-live="polite">
      <p className="sr-only" role="status">
        Loading workspace
      </p>
      <div className="loading-heading-skeleton">
        <span />
        <strong />
        <i />
      </div>
      <div className="loading-metric-grid" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <span key={index} />
        ))}
      </div>
      <div className="loading-panel-grid" aria-hidden="true">
        <span />
        <span />
      </div>
    </main>
  );
}
