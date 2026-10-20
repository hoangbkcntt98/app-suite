"use client";

import { appPath } from "@lifequest/lib/paths";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@lifequest/components/AppHeader";
import { apiFetch } from "@lifequest/lib/api";

type AiNarrationProvider = "none" | "openai" | "deepseek" | "9router";

type TuTienGame = {
  id: string;
  turn: number;
  difficulty: string;
  status: string;
  llmProvider: AiNarrationProvider;
};

type TuTienPlayer = {
  id: string;
  name: string;
  age: number;
  origin: string;
  spiritRoot: string;
  cultivation: number;
  realm: string;
  hp: number;
  maxHp: number;
  spiritStones: number;
  will: number;
  luck: number;
  reputation: number;
  inventory: string[];
};

type TuTienWorld = {
  id: string;
  name: string;
  year: number;
  region: string;
  sects: string[];
  factions: string[];
  publicEvents: string[];
};

type Scene = {
  id?: string;
  turn?: number;
  title: string;
  story: string;
  choices: string[];
};

type SavedGame = {
  id: string;
  turn: number;
  difficulty: string;
  status: string;
  updatedAt: string;
  player: Pick<TuTienPlayer, "name" | "realm" | "hp" | "maxHp"> | null;
  scene: Pick<Scene, "title" | "story"> | null;
};

type GameData = {
  game: TuTienGame | null;
  player: TuTienPlayer | null;
  world: TuTienWorld | null;
  scene: Scene | null;
  scenes: Scene[];
  savedGames: SavedGame[];
  aiNarrationAllowed: boolean;
  aiNarrationEnabled: boolean;
};

type NineRouterModelsCache = {
  fetchedAt: number;
  models: string[];
};

const NINE_ROUTER_MODELS_STORAGE_KEY = "lifequest.tu-tien.9router.models.v1";
const NINE_ROUTER_MODEL_STORAGE_KEY = "lifequest.tu-tien.9router.model.v1";
const NINE_ROUTER_MODELS_CACHE_MS = 10 * 60 * 1_000;

const AI_NARRATOR_OPTIONS: {
  value: AiNarrationProvider;
  label: string;
  desc: string;
}[] = [
  { value: "none", label: "Rules Engine", desc: "Offline narration" },
  { value: "openai", label: "OpenAI", desc: "Server-configured model" },
  { value: "deepseek", label: "DeepSeek", desc: "Server-configured model" },
  { value: "9router", label: "9router", desc: "Server-configured model" },
];

function narratorLabel(provider: AiNarrationProvider): string {
  return AI_NARRATOR_OPTIONS.find((option) => option.value === provider)?.label ?? "Rules Engine";
}

const ORIGINS_OPTIONS = [
  { value: "1", label: "Phàm nhân sơn thôn", desc: "Ý chí +2, Linh thạch +2" },
  { value: "2", label: "Con cháu tu tiên gia tộc sa sút", desc: "Khí vận +1, Linh thạch +12" },
  { value: "3", label: "Tạp dịch ngoại môn", desc: "Ý chí +1, Linh thạch +6" },
  { value: "4", label: "Tán tu lang bạt", desc: "Khí vận +2, Linh thạch +8" },
];

const ROOTS_OPTIONS = [
  { value: "1", label: "Ngũ linh căn", desc: "Hệ số 0.80 - Tiến chậm" },
  { value: "2", label: "Tam linh căn", desc: "Hệ số 1.00 - Bình thường" },
  { value: "3", label: "Song linh căn", desc: "Hệ số 1.20 - Tiến nhanh" },
  { value: "4", label: "Dị linh căn - Lôi", desc: "Hệ số 1.35 - Thiên tài" },
];

const DIFFICULTY_OPTIONS = [
  { value: "1", label: "Tiên hiệp giải trí", desc: "Dễ chơi, ít rủi ro" },
  { value: "2", label: "Tu tiên chân thực", desc: "Cân bằng" },
  { value: "3", label: "Phàm nhân lưu", desc: "Khó, nhiều rủi ro" },
  { value: "4", label: "Địa ngục", desc: "Cực khó, survive kém" },
];

export default function TuTienPage() {
  const router = useRouter();
  const [game, setGame] = useState<TuTienGame | null>(null);
  const [player, setPlayer] = useState<TuTienPlayer | null>(null);
  const [world, setWorld] = useState<TuTienWorld | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [savedGames, setSavedGames] = useState<SavedGame[]>([]);
  const [aiNarrationAllowed, setAiNarrationAllowed] = useState(false);
  const [aiNarrationEnabled, setAiNarrationEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [origin, setOrigin] = useState("1");
  const [root, setRoot] = useState("1");
  const [difficulty, setDifficulty] = useState("2");
  const [llmProvider, setLlmProvider] = useState<AiNarrationProvider>("none");
  const [nineRouterModels, setNineRouterModels] = useState<string[]>([]);
  const [nineRouterModel, setNineRouterModel] = useState("");
  const [nineRouterModelsLoading, setNineRouterModelsLoading] = useState(false);

  const [action, setAction] = useState("");
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [narratorSaving, setNarratorSaving] = useState(false);

  const loadNineRouterModels = useCallback(async (force = false) => {
    const cachedRaw = window.localStorage.getItem(NINE_ROUTER_MODELS_STORAGE_KEY);
    if (!force && cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw) as NineRouterModelsCache;
        if (
          Array.isArray(cached.models) &&
          cached.models.every((model) => typeof model === "string") &&
          Date.now() - cached.fetchedAt < NINE_ROUTER_MODELS_CACHE_MS
        ) {
          setNineRouterModels(cached.models);
          setNineRouterModel((current) => {
            const selected = current || window.localStorage.getItem(NINE_ROUTER_MODEL_STORAGE_KEY) || "";
            return cached.models.includes(selected) ? selected : cached.models[0] || "";
          });
          return;
        }
      } catch {
        window.localStorage.removeItem(NINE_ROUTER_MODELS_STORAGE_KEY);
      }
    }

    setNineRouterModelsLoading(true);
    try {
      const data = await apiFetch<{ models: string[] }>("/api/tu-tien/9router-models");
      const models = data.models.filter(
        (model): model is string => typeof model === "string" && Boolean(model.trim())
      );
      window.localStorage.setItem(
        NINE_ROUTER_MODELS_STORAGE_KEY,
        JSON.stringify({ fetchedAt: Date.now(), models } satisfies NineRouterModelsCache)
      );
      setNineRouterModels(models);
      setNineRouterModel((current) => {
        const selected = current || window.localStorage.getItem(NINE_ROUTER_MODEL_STORAGE_KEY) || "";
        return models.includes(selected) ? selected : models[0] || "";
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải 9router models.");
    } finally {
      setNineRouterModelsLoading(false);
    }
  }, []);

  function selectNineRouterModel(model: string) {
    setNineRouterModel(model);
    window.localStorage.setItem(NINE_ROUTER_MODEL_STORAGE_KEY, model);
  }

  function selectNarratorProvider(provider: AiNarrationProvider) {
    setLlmProvider(provider);
    if (provider === "9router") {
      void loadNineRouterModels();
    }
  }

  useEffect(() => {
    let mounted = true;

    void apiFetch<GameData>("/api/tu-tien")
      .then((data) => {
        if (!mounted) return;
        setGame(data.game);
        setPlayer(data.player);
        setWorld(data.world);
        setScene(data.scene);
        setScenes(data.scenes);
        setSavedGames(data.savedGames);
        setAiNarrationAllowed(data.aiNarrationAllowed);
        setAiNarrationEnabled(data.aiNarrationEnabled);
        if (data.game) {
          setLlmProvider(data.game.llmProvider);
          if (data.game.llmProvider === "9router") void loadNineRouterModels();
        }
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Không thể tải game.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [loadNineRouterModels]);

  useEffect(() => {
    if (nineRouterModel) {
      window.localStorage.setItem(NINE_ROUTER_MODEL_STORAGE_KEY, nineRouterModel);
    }
  }, [nineRouterModel]);

  async function createGame(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (llmProvider === "9router" && !nineRouterModel) {
      setError("Chọn 9router model trước khi bắt đầu.");
      return;
    }
    setCreating(true);

    try {
      const data = await apiFetch<{
        message: string;
        game: TuTienGame;
        player: TuTienPlayer;
        world: TuTienWorld;
        scene: Scene;
        scenes: Scene[];
        aiNarrationAllowed: boolean;
        aiNarrationEnabled: boolean;
      }>("/api/tu-tien", {
        method: "POST",
        body: JSON.stringify({
          name,
          origin,
          root,
          difficulty,
          llmProvider,
          narratorModel: llmProvider === "9router" ? nineRouterModel : undefined,
        }),
      });

      setGame(data.game);
      setPlayer(data.player);
      setWorld(data.world);
      setScene(data.scene);
      setScenes(data.scenes);
      setSavedGames([]);
      setAiNarrationAllowed(data.aiNarrationAllowed);
      setAiNarrationEnabled(data.aiNarrationEnabled);
      setLlmProvider(data.game.llmProvider);
      if (data.game.llmProvider === "9router") void loadNineRouterModels();
      setShowCreate(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Không thể tạo game.";
      setError(message);
      alert(message);
    } finally {
      setCreating(false);
    }
  }

  async function submitAction(choice?: number) {
    if (!game) return;
    setError("");
    if (game.llmProvider === "9router" && !nineRouterModel) {
      setError("Chọn 9router model trước khi tiếp tục.");
      return;
    }
    setProcessing(true);

    const actionText = choice !== undefined && scene?.choices[choice]
      ? scene.choices[choice]
      : action;

    if (!actionText.trim()) {
      setError("Nhập hành động.");
      setProcessing(false);
      return;
    }

    try {
      const data = await apiFetch<{
        message: string;
        result: {
          success: boolean;
          cultivationGain: number;
          stonesDelta: number;
          hpDelta: number;
          notes: string[];
          discovered: string[];
        };
        scene: Scene;
        player: Partial<TuTienPlayer>;
        world: Partial<TuTienWorld>;
        gameOver: boolean;
      }>("/api/tu-tien/action", {
        method: "POST",
        body: JSON.stringify({
          action: actionText,
          choice,
          narratorModel:
            game.llmProvider === "9router" ? nineRouterModel : undefined,
        }),
      });

      setScene(data.scene);
      setScenes((current) => [...current, data.scene]);
      setPlayer((p) => (p ? { ...p, ...data.player } : null));
      setWorld((w) => (w ? { ...w, ...data.world } : null));
      setGame((g) => (g ? { ...g, turn: g.turn + 1 } : null));
      setAction("");

      if (data.gameOver) {
        alert("Thân tử đạo tiêu. Tiên lộ của ngươi đã dừng lại ở đây.");
        router.push(appPath("/tu-tien"));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Không thể xử lý hành động.";
      setError(message);
      alert(message);
    } finally {
      setProcessing(false);
    }
  }

  async function endGame() {
    if (!confirm("Kết thúc game hiện tại?")) return;
    setError("");
    try {
      await apiFetch("/api/tu-tien", { method: "DELETE" });
      setGame(null);
      setPlayer(null);
      setWorld(null);
      setScene(null);
      setScenes([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể kết thúc game.");
    }
  }

  async function saveGame() {
    setSaving(true);
    setError("");

    try {
      const data = await apiFetch<{
        message: string;
        savedGame: SavedGame;
      }>("/api/tu-tien", {
        method: "PATCH",
        body: JSON.stringify({ operation: "save" }),
      });

      setGame(null);
      setPlayer(null);
      setWorld(null);
      setScene(null);
      setScenes([]);
      setSavedGames([data.savedGame]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể lưu game.");
    } finally {
      setSaving(false);
    }
  }

  async function resumeGame() {
    setSaving(true);
    setError("");

    try {
      const data = await apiFetch<GameData>("/api/tu-tien", {
        method: "PATCH",
        body: JSON.stringify({ operation: "resume" }),
      });

      setGame(data.game);
      setPlayer(data.player);
      setWorld(data.world);
      setScene(data.scene);
      setScenes(data.scenes);
      setSavedGames([]);
      setAiNarrationAllowed(data.aiNarrationAllowed);
      setAiNarrationEnabled(data.aiNarrationEnabled);
      if (data.game) {
        setLlmProvider(data.game.llmProvider);
        if (data.game.llmProvider === "9router") void loadNineRouterModels();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tiếp tục game.");
    } finally {
      setSaving(false);
    }
  }

  async function updateNarrator() {
    if (!game) return;
    if (llmProvider === "9router" && !nineRouterModel) {
      setError("Chọn 9router model trước khi đổi narrator.");
      return;
    }
    setNarratorSaving(true);
    setError("");

    try {
      const data = await apiFetch<{
        message: string;
        game: TuTienGame;
        aiNarrationAllowed: boolean;
        aiNarrationEnabled: boolean;
      }>("/api/tu-tien", {
        method: "PATCH",
        body: JSON.stringify({ operation: "narrator", llmProvider }),
      });

      setGame(data.game);
      setLlmProvider(data.game.llmProvider);
      if (data.game.llmProvider === "9router") void loadNineRouterModels();
      setAiNarrationAllowed(data.aiNarrationAllowed);
      setAiNarrationEnabled(data.aiNarrationEnabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể đổi AI kể chuyện.");
    } finally {
      setNarratorSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 text-white px-6 py-8">
        <div className="mx-auto max-w-6xl space-y-6">
          <AppHeader title="Cultivation World" subtitle="Đang tải hành trình tu luyện." />
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 text-center py-20">
            <span className="lifequest-spinner" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white px-6 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <AppHeader
          title="Cultivation World"
          subtitle="Lựa chọn của bạn định hình con đường tu luyện."
        />

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-300">
            {error}
          </div>
        )}

        {!game ? (
          <section className="mx-auto max-w-4xl rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold mb-2">Bắt đầu hành trình</h2>
              <p className="text-slate-400">
                Chọn xuất thân, linh căn và độ khó cho nhân vật của bạn.
              </p>
            </div>

            {savedGames.length > 0 ? (
              <div className="space-y-3">
                <div>
                  <h3 className="text-lg font-bold">Bản lưu</h3>
                  <p className="mt-1 text-sm text-slate-400">
                    Chọn bản lưu để tiếp tục câu truyện của nhân vật này.
                  </p>
                </div>
                {savedGames.map((savedGame) => (
                  <div
                    key={savedGame.id}
                    className="rounded-xl border border-slate-800 bg-slate-950 p-4"
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="font-semibold">
                          {savedGame.player?.name ?? "Nhân vật vô danh"} ·{" "}
                          {savedGame.player?.realm ?? "Phàm Nhân"}
                        </div>
                        <p className="mt-1 text-sm text-slate-400">
                          Lượt {savedGame.turn} · {savedGame.difficulty}
                        </p>
                        {savedGame.scene && (
                          <p className="mt-2 line-clamp-2 text-sm text-slate-400">
                            {savedGame.scene.title}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={resumeGame}
                        disabled={saving}
                        className="rounded-xl bg-indigo-500 px-4 py-3 font-medium hover:bg-indigo-400 disabled:opacity-50"
                      >
                        {saving ? "Đang mở..." : "Chơi tiếp"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : !showCreate ? (
              <button
                onClick={() => setShowCreate(true)}
                className="w-full rounded-xl bg-indigo-500 py-3 font-medium hover:bg-indigo-400"
              >
                Bắt đầu tu tiên
              </button>
            ) : (
              <form onSubmit={createGame} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-sm text-slate-300">Tên nhân vật</label>
                  <input
                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-4 py-3 outline-none focus:border-indigo-500"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Lâm Mặc"
                    required
                    maxLength={30}
                  />
                </div>

                <div className="space-y-3">
                  <label className="text-sm text-slate-300">Xuất thân</label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {ORIGINS_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setOrigin(opt.value)}
                        className={`rounded-xl border p-3 text-left transition ${
                          origin === opt.value
                            ? "border-indigo-500 bg-indigo-500/10"
                            : "border-slate-700 bg-slate-950 hover:border-slate-500"
                        }`}
                      >
                        <div className="font-semibold">{opt.label}</div>
                        <div className="text-sm text-slate-400">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-sm text-slate-300">Linh căn</label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {ROOTS_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setRoot(opt.value)}
                        className={`rounded-xl border p-3 text-left transition ${
                          root === opt.value
                            ? "border-indigo-500 bg-indigo-500/10"
                            : "border-slate-700 bg-slate-950 hover:border-slate-500"
                        }`}
                      >
                        <div className="font-semibold">{opt.label}</div>
                        <div className="text-sm text-slate-400">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-sm text-slate-300">Độ khó</label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {DIFFICULTY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setDifficulty(opt.value)}
                        className={`rounded-xl border p-3 text-left transition ${
                          difficulty === opt.value
                            ? "border-indigo-500 bg-indigo-500/10"
                            : "border-slate-700 bg-slate-950 hover:border-slate-500"
                        }`}
                      >
                        <div className="font-semibold">{opt.label}</div>
                        <div className="text-sm text-slate-400">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {aiNarrationAllowed && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm text-slate-300">Story narrator</label>
                      <p className="mt-1 text-xs text-slate-500">
                        API key, model, and URL remain server-side.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      {AI_NARRATOR_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => selectNarratorProvider(option.value)}
                          className={`rounded-xl border p-3 text-left transition ${
                            llmProvider === option.value
                              ? "border-indigo-500 bg-indigo-500/10"
                              : "border-slate-700 bg-slate-950 hover:border-slate-500"
                          }`}
                        >
                          <div className="font-semibold">{option.label}</div>
                          <div className="text-sm text-slate-400">{option.desc}</div>
                        </button>
                      ))}
                    </div>
                    {llmProvider === "9router" && (
                      <div className="rounded-xl border border-slate-700 bg-slate-950 p-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <label className="text-sm text-slate-300" htmlFor="create-9router-model">
                            9router model
                          </label>
                          <button
                            type="button"
                            onClick={() => void loadNineRouterModels(true)}
                            disabled={nineRouterModelsLoading}
                            className="text-xs text-indigo-300 hover:text-indigo-200 disabled:opacity-50"
                          >
                            {nineRouterModelsLoading ? "Loading..." : "Refresh"}
                          </button>
                        </div>
                        <select
                          id="create-9router-model"
                          value={nineRouterModel}
                          onChange={(event) => selectNineRouterModel(event.target.value)}
                          disabled={nineRouterModelsLoading || nineRouterModels.length === 0}
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-indigo-500 disabled:opacity-50"
                        >
                          {nineRouterModels.length === 0 ? (
                            <option value="">No model available</option>
                          ) : (
                            nineRouterModels.map((model) => (
                              <option key={model} value={model}>
                                {model}
                              </option>
                            ))
                          )}
                        </select>
                        <p className="mt-2 text-xs text-slate-500">
                          Model list cached in browser storage for 10 minutes.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowCreate(false)}
                    className="flex-1 rounded-xl border border-slate-700 py-3 font-medium hover:bg-slate-800"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={
                      creating ||
                      (llmProvider === "9router" &&
                        (nineRouterModelsLoading || !nineRouterModel))
                    }
                    className="flex-1 rounded-xl bg-indigo-500 py-3 font-medium hover:bg-indigo-400 disabled:opacity-50"
                  >
                    {creating ? "Đang tạo..." : "Bắt đầu"}
                  </button>
                </div>
              </form>
            )}
          </section>
        ) : (
          <div className="flex flex-col gap-4 sm:gap-6">
            {scene && (
              <section className="order-1 rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6 space-y-4">
                <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <h2 className="text-lg font-bold sm:text-xl">
                    {scene.title}
                  </h2>
                  <span className="shrink-0 text-xs text-slate-400">
                    Lượt {game.turn}
                  </span>
                </div>
                <div className="max-w-none text-[15px] leading-7 sm:text-base sm:leading-relaxed">
                  {scene.story.split("\n\n").map((para, idx) => (
                    <p key={idx} className="mb-4 last:mb-0 text-slate-300">
                      {para}
                    </p>
                  ))}
                </div>
              </section>
            )}

            {scenes.length > 1 && (
              <details className="order-2 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 sm:rounded-2xl sm:p-6">
                <summary className="cursor-pointer text-sm font-semibold text-indigo-300 sm:text-lg">
                  Toàn bộ câu truyện · {scenes.length} cảnh
                </summary>
                <div className="mt-4 max-h-[55dvh] space-y-3 overflow-y-auto overscroll-contain pr-1 sm:mt-5 sm:max-h-[65vh] sm:space-y-4 sm:pr-2">
                  {scenes.map((pastScene, index) => (
                    <article
                      key={pastScene.id ?? `${pastScene.turn ?? index}-${index}`}
                      className="rounded-xl border border-slate-800 bg-slate-950 p-3 sm:p-4"
                    >
                      <div className="mb-2 text-xs font-semibold text-indigo-300 sm:text-sm">
                        {pastScene.turn ? `Lượt ${pastScene.turn} · ` : ""}
                        {pastScene.title}
                      </div>
                      {pastScene.story.split("\n\n").map((paragraph, paragraphIndex) => (
                        <p
                          key={paragraphIndex}
                          className="mb-2 last:mb-0 text-sm leading-6 text-slate-300"
                        >
                          {paragraph}
                        </p>
                      ))}
                    </article>
                  ))}
                </div>
              </details>
            )}

            {scene?.choices && scene.choices.length > 0 && (
              <section className="order-3 rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6 space-y-3">
                <h3 className="text-base font-bold sm:text-lg">Lựa chọn</h3>
                {scene.choices.map((choice, idx) => (
                  <button
                    key={idx}
                    onClick={() => submitAction(idx)}
                    disabled={processing}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 p-3 text-left text-sm leading-6 hover:border-indigo-500 hover:bg-indigo-500/10 disabled:opacity-50 transition sm:p-4 sm:text-base"
                  >
                    <span className="font-semibold text-indigo-300">
                      {String.fromCharCode(65 + idx)}.
                    </span>{" "}
                    {choice}
                  </button>
                ))}
              </section>
            )}

            <section className="order-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6 space-y-3">
              <label className="text-xs text-slate-300 sm:text-sm">Hành động tự do</label>
              <textarea
                className="min-h-[80px] w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-indigo-500 sm:text-base"
                value={action}
                onChange={(e) => setAction(e.target.value)}
                placeholder="Nhập hành động của bạn..."
                disabled={processing}
              />
              <button
                onClick={() => submitAction()}
                disabled={processing || !action.trim()}
                className="w-full rounded-xl bg-indigo-500 py-3 text-sm font-medium hover:bg-indigo-400 disabled:opacity-50 sm:text-base"
              >
                {processing ? "Đang xử lý..." : "Thực hiện"}
              </button>
            </section>

            <details className="order-5 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 sm:rounded-2xl sm:p-6">
              <summary className="cursor-pointer text-sm font-semibold text-slate-200">
                Thông tin nhân vật · {player?.name ?? "Vô danh"} · HP {player?.hp}/{player?.maxHp}
              </summary>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4">
                <section className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                  <h3 className="mb-3 text-sm font-bold">{player?.name}</h3>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-400">Tu vi:</span>
                      <span className="text-indigo-300">{player?.realm}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-400">Cultivation:</span>
                      <span>{player?.cultivation.toFixed(1)}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-400">HP:</span>
                      <span className={player?.hp && player.hp < 30 ? "text-red-400" : ""}>
                        {player?.hp}/{player?.maxHp}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-400">Linh thạch:</span>
                      <span className="text-amber-300">{player?.spiritStones}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-400">Tuổi:</span>
                      <span>{player?.age}</span>
                    </div>
                  </div>
                </section>

                <section className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                  <h3 className="mb-3 text-sm font-bold">Chỉ số</h3>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-400">Ý chí:</span>
                      <span className="text-red-300">{player?.will}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-400">Khí vận:</span>
                      <span className="text-emerald-300">{player?.luck}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-400">Danh vọng:</span>
                      <span>{player?.reputation}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-400">Xuất thân:</span>
                      <span className="text-right text-slate-300">{player?.origin}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-400">Linh căn:</span>
                      <span className="text-right text-amber-300">{player?.spiritRoot}</span>
                    </div>
                  </div>
                </section>

                <section className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                  <h3 className="mb-3 text-sm font-bold">Thế giới</h3>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-400">Giới:</span>
                      <span className="text-right">{world?.name}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-400">Năm:</span>
                      <span>{world?.year}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-400">Vùng:</span>
                      <span className="text-right text-slate-300">{world?.region}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-400">Độ khó:</span>
                      <span className="text-right text-amber-300">{game.difficulty}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-400">Story narrator:</span>
                      <span className={aiNarrationEnabled ? "text-emerald-300" : "text-slate-400"}>
                        {aiNarrationEnabled
                          ? narratorLabel(game.llmProvider)
                          : game.llmProvider === "none"
                            ? "Rules Engine"
                            : `${narratorLabel(game.llmProvider)} unavailable`}
                      </span>
                    </div>
                  </div>

                  {aiNarrationAllowed && (
                    <div className="mt-4 flex flex-col gap-2 border-t border-slate-800 pt-3">
                      <label className="text-xs text-slate-400" htmlFor="tu-tien-narrator">
                        Change narrator. Applies to next scene.
                      </label>
                      <div className="flex gap-2">
                        <select
                          id="tu-tien-narrator"
                          value={llmProvider}
                          onChange={(event) =>
                            selectNarratorProvider(
                              event.target.value as AiNarrationProvider
                            )
                          }
                          disabled={narratorSaving || processing}
                          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-xs outline-none focus:border-indigo-500"
                        >
                          {AI_NARRATOR_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={updateNarrator}
                          disabled={
                            narratorSaving ||
                            processing ||
                            llmProvider === game.llmProvider ||
                            (llmProvider === "9router" &&
                              (nineRouterModelsLoading || !nineRouterModel))
                          }
                          className="rounded-lg bg-indigo-500 px-3 py-2 text-xs font-medium hover:bg-indigo-400 disabled:opacity-50"
                        >
                          {narratorSaving ? "Saving..." : "Change"}
                        </button>
                      </div>
                      {llmProvider === "9router" && (
                        <div className="rounded-lg border border-slate-700 bg-slate-950 p-3">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <label
                              className="text-xs text-slate-400"
                              htmlFor="tu-tien-9router-model"
                            >
                              9router model. Applies to next scene.
                            </label>
                            <button
                              type="button"
                              onClick={() => void loadNineRouterModels(true)}
                              disabled={nineRouterModelsLoading || processing}
                              className="text-xs text-indigo-300 hover:text-indigo-200 disabled:opacity-50"
                            >
                              {nineRouterModelsLoading ? "Loading..." : "Refresh"}
                            </button>
                          </div>
                          <select
                            id="tu-tien-9router-model"
                            value={nineRouterModel}
                            onChange={(event) => selectNineRouterModel(event.target.value)}
                            disabled={
                              narratorSaving ||
                              processing ||
                              nineRouterModelsLoading ||
                              nineRouterModels.length === 0
                            }
                            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-xs outline-none focus:border-indigo-500 disabled:opacity-50"
                          >
                            {nineRouterModels.length === 0 ? (
                              <option value="">No model available</option>
                            ) : (
                              nineRouterModels.map((model) => (
                                <option key={model} value={model}>
                                  {model}
                                </option>
                              ))
                            )}
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              </div>

              {player?.inventory && player.inventory.length > 0 && (
                <section className="mt-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
                  <h3 className="mb-3 text-sm font-bold">Vật phẩm</h3>
                  <div className="flex flex-wrap gap-2">
                    {player.inventory.map((item, idx) => (
                      <span
                        key={idx}
                        className="rounded-lg bg-slate-800 px-2 py-1 text-xs"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </section>
              )}
            </details>

            <div className="order-6 flex flex-col gap-2 sm:flex-row sm:justify-end sm:gap-3">
              <button
                onClick={saveGame}
                disabled={saving || processing}
                className="w-full rounded-xl border border-slate-700 px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50 sm:w-auto"
              >
                {saving ? "Đang lưu..." : "Lưu game"}
              </button>
              <button
                onClick={endGame}
                disabled={saving || processing}
                className="w-full rounded-xl border border-red-500/50 px-4 py-2 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50 sm:w-auto"
              >
                Kết thúc game
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
