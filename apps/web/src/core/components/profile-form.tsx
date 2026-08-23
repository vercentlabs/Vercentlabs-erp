"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { requestJson } from "@/core/client-request";

type ProfileFormProps = {
  fullName: string;
  locale: string;
  timezone: string;
  theme: "system" | "light" | "dark";
};

export default function ProfileForm(props: ProfileFormProps) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    setMessage("");
    setError("");
    startTransition(async () => {
      const data = await requestJson("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: formData.get("fullName"),
          locale: formData.get("locale"),
          timezone: formData.get("timezone"),
          theme: formData.get("theme"),
        }),
      });
      if (!data.ok) {
        setError(data.message || "The profile could not be updated.");
        return;
      }
      setMessage("Profile settings updated.");
      router.refresh();
    });
  }

  return (
    <form action={submit} className="form-stack">
      <label>
        Full name
        <input
          name="fullName"
          defaultValue={props.fullName}
          minLength={2}
          maxLength={100}
          required
        />
      </label>
      <div className="form-grid two">
        <label>
          Locale
          <select name="locale" defaultValue={props.locale}>
            <option value="en-IN">English (India)</option>
            <option value="en-US">English (United States)</option>
            <option value="en-GB">English (United Kingdom)</option>
          </select>
        </label>
        <label>
          Timezone
          <input
            name="timezone"
            defaultValue={props.timezone}
            minLength={3}
            maxLength={80}
            required
          />
        </label>
      </div>
      <label>
        Appearance
        <select name="theme" defaultValue={props.theme}>
          <option value="system">Use system setting</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
      <button className="primary-button" disabled={pending} type="submit">
        {pending ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}
