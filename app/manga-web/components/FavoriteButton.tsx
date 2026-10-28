"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiPath } from "@manga/lib/paths";

export default function FavoriteButton({
  mangaId,
  initialFavorite,
  className,
}: {
  mangaId: string;
  initialFavorite: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [favorite, setFavorite] = useState(initialFavorite);
  const [loading, setLoading] = useState(false);

  async function toggleFavorite() {
    setLoading(true);
    try {
      const response = await fetch(apiPath(`/api/favorites/${mangaId}`), {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Update failed");
      setFavorite(data.favorite);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      className={className}
      disabled={loading}
      onClick={toggleFavorite}
      type="button"
    >
      {favorite ? "♥ Đã yêu thích" : "♡ Thêm yêu thích"}
    </button>
  );
}
