"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";

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
    <div className="flex min-h-[70vh] items-center justify-center bg-white px-5 py-20">
      <div className="max-w-xl text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
          <AlertTriangle aria-hidden="true" className="h-7 w-7" />
        </div>

        <h1 className="font-display mt-6 text-4xl font-extrabold tracking-[-0.04em] text-slate-950">
          This page could not be displayed.
        </h1>

        <p className="mt-5 text-base leading-8 text-slate-600">
          Try loading the page again. No product or account action should be
          assumed to have completed until a success message is shown.
        </p>

        <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
          <button type="button" onClick={reset} className="button-primary">
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            Try again
          </button>

          <Link href="/" className="button-secondary">
            Return home
          </Link>
        </div>
      </div>
    </div>
  );
}
