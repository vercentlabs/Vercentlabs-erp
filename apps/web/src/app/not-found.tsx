import Link from "next/link";
export default function NotFound() {
  return (
    <main className="system-state">
      <div className="system-icon">404</div>
      <h1>Page not found</h1>
      <p>
        The requested workspace page does not exist or is outside your access
        scope.
      </p>
      <Link className="primary-button" href="/dashboard">
        Return to dashboard
      </Link>
    </main>
  );
}
