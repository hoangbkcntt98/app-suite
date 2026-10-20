"use client";

import { appPath } from "@lifequest/lib/paths";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@lifequest/lib/api";

type Character = {
  id: string;
  name: string;
  className: string;
  level: number;
  exp: number;
  gold: number;
};

export default function SelectCharacterPage() {
  const router = useRouter();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectingId, setSelectingId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;

    apiFetch<{
      characters: Character[];
      selectedCharacter?: Character | null;
    }>("/api/character")
      .then((data) => {
        if (ignore) return;

        setCharacters(data.characters);
        setSelectedCharacterId(data.selectedCharacter?.id ?? "");
      })
      .catch((loadError) => {
        if (ignore) return;

        setError(
          loadError instanceof Error ? loadError.message : "Cannot load characters."
        );
      })
      .finally(() => {
        if (ignore) return;

        setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, []);

  async function selectCharacter(characterId: string) {
    setSelectingId(characterId);
    setError("");

    try {
      await apiFetch("/api/character/select", {
        method: "POST",
        body: JSON.stringify({
          characterId,
        }),
      });

      router.push(appPath("/dashboard"));
    } catch (selectError) {
      setError(
        selectError instanceof Error
          ? selectError.message
          : "Cannot select character."
      );
    } finally {
      setSelectingId("");
    }
  }

  async function deleteCharacter(character: Character) {
    const confirmed = window.confirm(
      `Xóa nhân vật "${character.name}"?\n\nToàn bộ stats, mission và lịch sử mission của nhân vật này sẽ bị xóa vĩnh viễn.`
    );

    if (!confirmed) return;

    setDeletingId(character.id);
    setError("");

    try {
      const data = await apiFetch<{ selectedCharacter: Character | null }>(
        `/api/character/${character.id}`,
        {
          method: "DELETE",
        }
      );

      setCharacters((current) =>
        current.filter((currentCharacter) => currentCharacter.id !== character.id)
      );
      setSelectedCharacterId(data.selectedCharacter?.id ?? "");
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Cannot delete character."
      );
    } finally {
      setDeletingId("");
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white px-6 py-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-700">
              Character Roster
            </div>
            <h1 className="text-3xl font-bold">Chọn nhân vật</h1>
            <p className="mt-2 text-slate-400">
              Chọn character để tiếp tục hành trình, hoặc tạo nhân vật mới.
            </p>
          </div>

          <Link
            href={appPath("/character/create")}
            className="rounded-xl bg-indigo-500 px-5 py-3 text-center font-semibold hover:bg-indigo-400"
          >
            Tạo nhân vật mới
          </Link>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <span className="lifequest-spinner" /> Loading characters...
          </div>
        ) : characters.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-400">
            Bạn chưa có character nào. Hãy tạo nhân vật đầu tiên.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {characters.map((character) => (
              <div
                key={character.id}
                className={`rounded-2xl border bg-slate-900 p-6 text-left shadow-xl ${
                  selectedCharacterId === character.id
                    ? "border-indigo-500"
                    : "border-slate-800"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium text-indigo-400">
                      {character.className}
                    </div>
                    <h2 className="mt-1 text-2xl font-bold">{character.name}</h2>
                  </div>
                  <div className="text-4xl">🧙</div>
                </div>

                <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                    <div className="text-slate-400">Level</div>
                    <div className="mt-1 font-bold">{character.level}</div>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                    <div className="text-slate-400">EXP</div>
                    <div className="mt-1 font-bold">{character.exp}</div>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                    <div className="text-slate-400">Gold</div>
                    <div className="mt-1 font-bold">{character.gold}</div>
                  </div>
                </div>

                <div className="mt-5 flex gap-3">
                  <button
                    onClick={() => selectCharacter(character.id)}
                    disabled={Boolean(selectingId || deletingId)}
                    className="flex-1 rounded-xl bg-indigo-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {selectingId === character.id
                      ? "Đang chọn..."
                      : selectedCharacterId === character.id
                        ? "Đang được chọn"
                        : "Chọn character này"}
                  </button>
                  <button
                    onClick={() => deleteCharacter(character)}
                    disabled={Boolean(selectingId || deletingId)}
                    className="rounded-xl border border-red-500/40 px-4 py-3 text-sm font-semibold text-red-300 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {deletingId === character.id ? "Đang xóa..." : "Xóa"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
