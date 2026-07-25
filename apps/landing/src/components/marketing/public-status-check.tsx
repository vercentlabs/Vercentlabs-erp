"use client";

import { useEffect, useState } from "react";

type PublicStatus =
  | { state: "checking"; message: string }
  | { state: "operational"; message: string }
  | { state: "unavailable"; message: string };

export default function PublicStatusCheck() {
  const [status, setStatus] = useState<PublicStatus>({
    state: "checking",
    message: "Checking this deployment…",
  });

  useEffect(() => {
    const controller = new AbortController();
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      setStatus({
        state: "unavailable",
        message: "The public health check timed out.",
      });
      controller.abort();
    }, 8000);

    async function check() {
      try {
        const response = await fetch("/api/health", {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: controller.signal,
        });
        const result = (await response.json().catch(() => null)) as {
          ok?: boolean;
          status?: string;
        } | null;

        if (
          response.ok &&
          result?.ok === true &&
          result.status === "operational"
        ) {
          setStatus({
            state: "operational",
            message: "This public deployment is responding normally.",
          });
          return;
        }

        setStatus({
          state: "unavailable",
          message: "The public health check returned an unexpected response.",
        });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setStatus({
            state: "unavailable",
            message: "The public health check could not be reached.",
          });
        }
      } finally {
        settled = true;
        window.clearTimeout(timer);
      }
    }

    void check();
    return () => {
      settled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  return (
    <p
      className="public-status-check"
      data-state={status.state}
      role="status"
      aria-live="polite"
    >
      <span aria-hidden="true" />
      {status.message}
    </p>
  );
}
