"use client";

import { useState } from "react";

import AppIcon from "@/components/app-icon";

// The one deliberate favourite add/remove control this prompt ships on
// record pages (Part 8: "restrained UI... not scattered star icons
// everywhere"). Talks only to /api/favourites — all target validation and
// access re-checks happen server-side (see apps/web/src/lib/favourites.ts).
export default function FavouriteToggle({
  href,
  label,
  targetType,
  moduleKey,
  initialFavourited,
}: {
  href: string;
  label: string;
  targetType: string;
  moduleKey: string;
  initialFavourited: boolean;
}) {
  const [favourited, setFavourited] = useState(initialFavourited);
  const [pending, setPending] = useState(false);
  const [favouriteId, setFavouriteId] = useState<string | null>(null);

  async function toggle() {
    if (pending) return;
    setPending(true);
    try {
      if (favourited) {
        if (favouriteId) {
          await fetch("/api/favourites", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: favouriteId }),
          });
        }
        setFavourited(false);
        setFavouriteId(null);
      } else {
        const response = await fetch("/api/favourites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ href, label, targetType, moduleKey }),
        });
        if (response.ok) {
          const body = await response.json();
          setFavouriteId(body.favourite?.id ?? null);
          setFavourited(true);
        }
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      className={`favourite-toggle${favourited ? " active" : ""}`}
      onClick={toggle}
      disabled={pending}
      aria-pressed={favourited}
      aria-label={favourited ? "Remove from favourites" : "Add to favourites"}
    >
      <AppIcon name="sparkles" size={16} />
      {favourited ? "Favourited" : "Favourite"}
    </button>
  );
}
