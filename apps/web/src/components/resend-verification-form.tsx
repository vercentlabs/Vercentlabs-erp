"use client";

import { FormEvent, useState } from "react";

export default function ResendVerificationForm({
  defaultEmail = "",
}: {
  defaultEmail?: string;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [developmentUrl, setDevelopmentUrl] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setDevelopmentUrl("");
    const email = String(new FormData(event.currentTarget).get("email") || "");
    try {
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const result = (await response.json()) as {
        message?: string;
        developmentUrl?: string;
      };
      setMessage(result.message || "Request completed.");
      setDevelopmentUrl(result.developmentUrl || "");
    } catch {
      setMessage("The server could not be reached.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="form-stack" onSubmit={submit}>
      <label>
        Work email
        <input
          name="email"
          type="email"
          defaultValue={defaultEmail}
          autoComplete="email"
          required
          maxLength={254}
        />
      </label>
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send a new verification link"}
      </button>
      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
      {developmentUrl ? (
        <a className="development-link" href={developmentUrl}>
          Open the local verification link
        </a>
      ) : null}
    </form>
  );
}
