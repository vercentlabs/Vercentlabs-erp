export default function Loading() {
  return (
    <main
      id="main-content"
      className="operator-state-page"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="operator-state-page__frame">
        <span className="os-wordmark os-wordmark--header" aria-hidden="true">
          <span>VERCENT</span>
          <span>LABS</span>
          <i />
        </span>
        <div className="operator-state-page__progress" aria-hidden="true">
          <span />
        </div>
        <p className="os-mono-label">Preparing public route</p>
        <h1>Loading the operating context.</h1>
      </div>
    </main>
  );
}
