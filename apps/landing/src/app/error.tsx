"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";

type ErrorPageProps = {
  error: Error & {
    digest?: string;
  };
  reset: () => void;
};

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main id="main-content" className="operator-state-page">
      <div className="operator-state-page__frame">
        <span className="operator-state-page__code">ERROR / ROUTE</span>
        <p className="os-eyebrow">Public website state</p>
        <h1>This route could not be displayed safely.</h1>
        <p>
          Retry the route. No enquiry, account, payment or product action should
          be assumed complete until a specific success response is shown.
        </p>
        <div className="operator-actions">
          <button type="button" onClick={reset} className="button-primary">
            <RefreshCw aria-hidden="true" />
            Try again
          </button>
          <Link href="/" className="button-secondary">
            Return home
          </Link>
        </div>
      </div>
    </main>
  );
}
