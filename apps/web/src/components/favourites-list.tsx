"use client";

import Link from "next/link";
import { useState } from "react";

import AppIcon from "@/components/app-icon";
import type { FavouriteItem } from "@/lib/favourites";

export default function FavouritesList({
  favourites,
}: {
  favourites: FavouriteItem[];
}) {
  const [items, setItems] = useState(favourites);

  async function remove(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
    await fetch("/api/favourites", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }

  if (!items.length) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon" aria-hidden="true">
          <AppIcon name="check" size={22} />
        </span>
        <div>
          <strong>No favourites yet</strong>
          <p>Star a record from its page to pin it here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="stack-list">
      {items.map((item) => (
        <div key={item.id}>
          <Link href={item.href}>
            <strong>{item.label}</strong>
            <span>{item.moduleKey || item.targetType}</span>
          </Link>
          <button
            type="button"
            className="secondary-button"
            onClick={() => remove(item.id)}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}
