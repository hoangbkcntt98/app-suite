"use client";

import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import AppHeader from "@lifequest/components/AppHeader";
import { apiPath } from "@lifequest/lib/paths";
import { apiFetch } from "@lifequest/lib/api";

type MusicTrack = {
  id: string;
  name: string;
  url: string;
  size: number;
  uploadedAt: string;
  uploadedBy: {
    id: string;
    email: string;
  };
  canManage: boolean;
};

type TimerMode = "focus" | "shortBreak" | "longBreak";

type FocusMission = {
  id: string;
  title: string;
  difficulty: string;
  isActive: boolean;
  expReward: number;
  goldReward: number;
  statReward: number;
  attribute: {
    id: string;
    name: string;
    icon: string | null;
    color: string | null;
  };
  logs?: {
    completedDate: string;
  }[];
};

type CompleteMissionResponse = {
  reward: {
    exp: number;
    gold: number;
    stat: number;
    attributeName: string;
  };
};

type FocusRewardResponse = {
  reward: {
    gold: number;
  };
};

const TIMER_PRESETS: Record<TimerMode, { label: string; minutes: number }> = {
  focus: { label: "Focus", minutes: 25 },
  shortBreak: { label: "Short break", minutes: 5 },
  longBreak: { label: "Long break", minutes: 15 },
};
const MAX_AUDIO_FILE_SIZE = 350 * 1024 * 1024;
const MAX_BACKGROUND_FILE_SIZE = 5 * 1024 * 1024;
const FOCUS_MINUTES_STORAGE_KEY = "lifequest-focus-minutes";
const FOCUS_BACKGROUND_STORAGE_KEY = "lifequest-focus-background";
const FOCUS_MINUTE_OPTIONS = Array.from(
  { length: 8 },
  (_, index) => (index + 1) * 25
);

function getInitialFocusMinutes() {
  if (typeof window === "undefined") return TIMER_PRESETS.focus.minutes;

  const savedValue = Number(window.localStorage.getItem(FOCUS_MINUTES_STORAGE_KEY));

  if (!Number.isFinite(savedValue)) return TIMER_PRESETS.focus.minutes;

  const closestOption =
    Math.round(savedValue / TIMER_PRESETS.focus.minutes) *
    TIMER_PRESETS.focus.minutes;

  return Math.min(200, Math.max(25, closestOption));
}

function getInitialFocusBackground() {
  if (typeof window === "undefined") return "";

  return window.localStorage.getItem(FOCUS_BACKGROUND_STORAGE_KEY) ?? "";
}

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
    2,
    "0"
  )}`;
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getTokyoDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";

  return `${year}-${month}-${day}`;
}

function isMissionOpenToday(mission: FocusMission) {
  const todayKey = getTokyoDateKey();

  return (
    mission.isActive &&
    !(mission.logs ?? []).some((log) =>
      log.completedDate.slice(0, 10) === todayKey
    )
  );
}

async function requestFocusNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "default") return;

  await Notification.requestPermission();
}

async function showFocusCompleteNotification(missionTitle?: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const body = missionTitle
    ? `Bạn vừa hoàn thành một phiên Pomodoro cho "${missionTitle}". Tuyệt vời lắm, tiếp tục cố gắng nhé!`
    : "Bạn vừa hoàn thành một phiên Pomodoro. Tuyệt vời lắm, hãy tiếp tục cố gắng nhé!";

  const options: NotificationOptions = {
    body,
    icon: apiPath("/images/logo.png"),
    badge: apiPath("/images/logo.png"),
    data: {
      url: apiPath("/focus"),
    },
  };

  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.register(apiPath("/sw.js"));
    await registration.showNotification("Pomodoro hoàn thành!", options);
    return;
  }

  new Notification("Pomodoro hoàn thành!", options);
}

export default function FocusPage() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [selectedTrackUrl, setSelectedTrackUrl] = useState("");
  const [mode, setMode] = useState<TimerMode>("focus");
  const [focusMinutes, setFocusMinutes] = useState(getInitialFocusMinutes);
  const [secondsLeft, setSecondsLeft] = useState(focusMinutes * 60);
  const [running, setRunning] = useState(false);
  const [completedSessions, setCompletedSessions] = useState(0);
  const [focusMode, setFocusMode] = useState(false);
  const [pomodoroBackground, setPomodoroBackground] = useState(
    getInitialFocusBackground
  );
  const [volume, setVolume] = useState(0.7);
  const [loop, setLoop] = useState(true);
  const [loadingTracks, setLoadingTracks] = useState(true);
  const [missions, setMissions] = useState<FocusMission[]>([]);
  const [selectedMissionId, setSelectedMissionId] = useState("");
  const [loadingMissions, setLoadingMissions] = useState(true);
  const [completingMission, setCompletingMission] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [renamingTrackName, setRenamingTrackName] = useState("");
  const [deletingTrackName, setDeletingTrackName] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selectedTrack = useMemo(
    () => tracks.find((track) => track.url === selectedTrackUrl),
    [selectedTrackUrl, tracks]
  );

  const selectedMission = useMemo(
    () => missions.find((mission) => mission.id === selectedMissionId),
    [missions, selectedMissionId]
  );

  const awardPomodoroGold = useCallback(async (minutes: number) => {
    try {
      const result = await apiFetch<FocusRewardResponse>("/api/focus/reward", {
        method: "POST",
        body: JSON.stringify({
          minutes,
        }),
      });

      setMessage(
        `Pomodoro complete. +${result.reward.gold} Gold for your focus.`
      );
    } catch (rewardError) {
      setError(
        rewardError instanceof Error
          ? rewardError.message
          : "Cannot add Pomodoro gold reward."
      );
    }
  }, []);

  const completeAttachedMission = useCallback(async () => {
    if (!selectedMissionId || completingMission) return;

    const missionTitle = selectedMission?.title ?? "Attached mission";
    setCompletingMission(true);
    setError("");

    try {
      const result = await apiFetch<CompleteMissionResponse>(
        `/api/missions/${selectedMissionId}/complete`,
        {
          method: "POST",
        }
      );

      setMissions((current) =>
        current.filter((mission) => mission.id !== selectedMissionId)
      );
      setSelectedMissionId("");
      setMessage(
        `${missionTitle} completed. +${result.reward.exp} EXP, +${result.reward.gold} Gold, +${result.reward.stat} ${result.reward.attributeName}.`
      );
    } catch (missionError) {
      setError(
        missionError instanceof Error
          ? missionError.message
          : "Cannot complete attached mission."
      );
      setMessage("Focus session complete, but the attached mission was not completed.");
    } finally {
      setCompletingMission(false);
    }
  }, [completingMission, selectedMission?.title, selectedMissionId]);

  useEffect(() => {
    let ignore = false;

    fetch(apiPath("/api/music"), {
      credentials: "include",
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as
          | { tracks?: MusicTrack[]; message?: string }
          | null;

        if (!response.ok) {
          throw new Error(data?.message || "Cannot load music library.");
        }

        return data?.tracks ?? [];
      })
      .then((nextTracks) => {
        if (ignore) return;

        setTracks(nextTracks);

        if (nextTracks.length > 0) {
          setSelectedTrackUrl(nextTracks[0].url);
        }
      })
      .catch((fetchError) => {
        if (ignore) return;

        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Cannot load music library."
        );
      })
      .finally(() => {
        if (ignore) return;

        setLoadingTracks(false);
      });

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    let ignore = false;

    apiFetch<{ missions: FocusMission[] }>("/api/missions")
      .then((data) => {
        if (ignore) return;

        const activeMissions = data.missions.filter(isMissionOpenToday);

        setMissions(activeMissions);
        setSelectedMissionId((current) => {
          if (current && activeMissions.some((mission) => mission.id === current)) {
            return current;
          }

          return activeMissions[0]?.id ?? "";
        });
      })
      .catch((missionError) => {
        if (ignore) return;

        setError(
          missionError instanceof Error
            ? missionError.message
            : "Cannot load missions."
        );
      })
      .finally(() => {
        if (ignore) return;

        setLoadingMissions(false);
      });

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    if (!running) return;

    const timer = window.setInterval(() => {
      setSecondsLeft((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          setRunning(false);

          if (mode === "focus") {
            setCompletedSessions((count) => count + 1);
            void showFocusCompleteNotification(selectedMission?.title);
            void awardPomodoroGold(focusMinutes);
          }

          setMessage(`${TIMER_PRESETS[mode].label} session complete.`);
          return 0;
        }

        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [awardPomodoroGold, focusMinutes, mode, running, selectedMission?.title]);

  function switchMode(nextMode: TimerMode) {
    setMode(nextMode);
    setRunning(false);
    setSecondsLeft(
      (nextMode === "focus" ? focusMinutes : TIMER_PRESETS[nextMode].minutes) *
        60
    );
    setMessage("");
  }

  function updateFocusMinutes(value: string) {
    const requestedMinutes = Number(value);
    const nextMinutes = FOCUS_MINUTE_OPTIONS.includes(requestedMinutes)
      ? requestedMinutes
      : TIMER_PRESETS.focus.minutes;

    setFocusMinutes(nextMinutes);
    window.localStorage.setItem(FOCUS_MINUTES_STORAGE_KEY, String(nextMinutes));

    if (mode === "focus") {
      setRunning(false);
      setSecondsLeft(nextMinutes * 60);
      setMessage("");
    }
  }

  function toggleTimer() {
    if (running) {
      setRunning(false);
      return;
    }

    if (mode === "focus") {
      void requestFocusNotificationPermission();
    }

    setRunning(true);
  }

  function resetTimer() {
    setRunning(false);
    setSecondsLeft(
      (mode === "focus" ? focusMinutes : TIMER_PRESETS[mode].minutes) * 60
    );
    setMessage("");
  }

  function handleBackgroundUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Please upload an image file for the Pomodoro background.");
      event.target.value = "";
      return;
    }

    if (file.size > MAX_BACKGROUND_FILE_SIZE) {
      setError("Background image must be 5MB or smaller.");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";

      if (!dataUrl) {
        setError("Cannot load background image.");
        return;
      }

      try {
        window.localStorage.setItem(FOCUS_BACKGROUND_STORAGE_KEY, dataUrl);
      } catch {
        setError("Background image is too large to save in this browser.");
        return;
      }

      setPomodoroBackground(dataUrl);
      setError("");
      setMessage("Pomodoro background updated.");
      event.target.value = "";
    };

    reader.onerror = () => {
      setError("Cannot load background image.");
      event.target.value = "";
    };

    reader.readAsDataURL(file);
  }

  function clearPomodoroBackground() {
    window.localStorage.removeItem(FOCUS_BACKGROUND_STORAGE_KEY);
    setPomodoroBackground("");
    setMessage("Pomodoro background removed.");
  }

  function uploadTrack(file: File) {
    return new Promise<{ tracks?: MusicTrack[]; track?: MusicTrack; message?: string }>(
      (resolve, reject) => {
        const formData = new FormData();
        formData.append("file", file);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", apiPath("/api/music"));
        xhr.withCredentials = true;

        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;

          setUploadProgress(Math.round((event.loaded / event.total) * 100));
        };

        xhr.onload = () => {
          const data = JSON.parse(xhr.responseText || "null") as
            | { tracks?: MusicTrack[]; track?: MusicTrack; message?: string }
            | null;

          if (xhr.status < 200 || xhr.status >= 300) {
            reject(new Error(data?.message || "Upload failed."));
            return;
          }

          resolve(data ?? {});
        };

        xhr.onerror = () => reject(new Error("Upload failed."));
        xhr.onabort = () => reject(new Error("Upload cancelled."));
        xhr.send(formData);
      }
    );
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_AUDIO_FILE_SIZE) {
      setError("Audio file must be 350MB or smaller.");
      event.target.value = "";
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setError("");
    setMessage("");

    try {
      const data = await uploadTrack(file);

      const nextTracks = data?.tracks ?? [];
      setTracks(nextTracks);

      if (data?.track) {
        setSelectedTrackUrl(data.track.url);
      }

      setMessage("Track uploaded. Your focus playlist is ready.");
      event.target.value = "";
      setUploadProgress(100);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "Upload failed."
      );
    } finally {
      setUploading(false);
      window.setTimeout(() => setUploadProgress(0), 1200);
    }
  }

  async function deleteTrack(track: MusicTrack) {
    const ok = window.confirm(`Xóa track "${track.name}"?`);
    if (!ok) return;

    try {
      setError("");
      setDeletingTrackName(track.id);
      const response = await fetch(
        apiPath(`/api/music?id=${encodeURIComponent(track.id)}`),
        {
          method: "DELETE",
          credentials: "include",
        }
      );
      const data = (await response.json().catch(() => null)) as
        | { tracks?: MusicTrack[]; message?: string }
        | null;

      if (!response.ok) {
        throw new Error(data?.message || "Cannot delete track.");
      }

      const nextTracks = data?.tracks ?? [];
      setTracks(nextTracks);

      if (track.url === selectedTrackUrl) {
        setSelectedTrackUrl(nextTracks[0]?.url ?? "");
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Cannot delete track."
      );
    } finally {
      setDeletingTrackName("");
    }
  }

  async function renameTrack(track: MusicTrack) {
    const nextName = window.prompt("Tên track mới", track.name);
    if (!nextName || nextName.trim() === track.name) return;

    try {
      setError("");
      setMessage("");
      setRenamingTrackName(track.id);

      const response = await fetch(
        apiPath(`/api/music?id=${encodeURIComponent(track.id)}`),
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: nextName.trim(),
          }),
          credentials: "include",
        }
      );
      const data = (await response.json().catch(() => null)) as
        | { tracks?: MusicTrack[]; track?: MusicTrack; message?: string }
        | null;

      if (!response.ok) {
        throw new Error(data?.message || "Cannot rename track.");
      }

      const nextTracks = data?.tracks ?? [];
      setTracks(nextTracks);

      if (track.url === selectedTrackUrl && data?.track) {
        setSelectedTrackUrl(data.track.url);
      }

      setMessage("Track renamed.");
    } catch (renameError) {
      setError(
        renameError instanceof Error
          ? renameError.message
          : "Cannot rename track."
      );
    } finally {
      setRenamingTrackName("");
    }
  }

  return (
    <main
      className={`min-h-screen bg-slate-950 text-white px-6 py-8 ${
        focusMode ? "fixed inset-0 z-50 overflow-y-auto" : ""
      }`}
      style={
        focusMode && pomodoroBackground
          ? {
              backgroundImage: `linear-gradient(180deg, rgba(15, 23, 42, 0.28), rgba(15, 23, 42, 0.52)), url(${pomodoroBackground})`,
              backgroundPosition: "center",
              backgroundSize: "cover",
            }
          : undefined
      }
    >
      <div className={focusMode ? "mx-auto max-w-4xl space-y-6" : "mx-auto max-w-6xl space-y-6"}>
        {!focusMode && (
          <AppHeader
            title="Focus Studio"
            subtitle="Bật nhạc, vào flow, hoàn thành một phiên Pomodoro."
          />
        )}

        {focusMode && (
          <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center text-center">
            <button
              onClick={() => setFocusMode(false)}
              aria-label="Exit focus mode"
              className="absolute right-5 top-5 grid h-11 w-11 place-items-center rounded-full border border-white/40 bg-white/80 text-xl font-bold text-slate-950 shadow-xl hover:bg-white"
            >
              ×
            </button>
            <div className="rounded-full border-8 border-white/50 bg-white/90 px-10 py-12 shadow-xl backdrop-blur">
              <div className="text-6xl font-black text-slate-950 md:text-8xl">
                {formatTime(secondsLeft)}
              </div>
            </div>
            <div className="mt-6 max-w-3xl rounded-full bg-white/85 px-6 py-3 text-lg font-bold text-slate-950 shadow-xl backdrop-blur">
              {selectedMission ? selectedMission.title : "No mission attached"}
            </div>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <button
                onClick={toggleTimer}
                className="rounded-xl bg-indigo-500 px-8 py-3 font-semibold text-white shadow-xl hover:bg-indigo-400"
              >
                {running ? "Pause" : "Start"}
              </button>
              <button
                onClick={resetTimer}
                className="rounded-xl border border-white/50 bg-white/85 px-8 py-3 font-semibold text-slate-950 shadow-xl hover:bg-white"
              >
                Reset
              </button>
            </div>
          </div>
        )}

        {!focusMode && error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-300">
            {error}
          </div>
        )}

        {!focusMode && message && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-emerald-300">
            {message}
          </div>
        )}

        <section
          className={
            focusMode
              ? "fixed bottom-5 left-1/2 z-[60] w-[min(92vw,28rem)] -translate-x-1/2"
              : "grid grid-cols-1 gap-6 lg:grid-cols-3"
          }
        >
          <div
            className={`lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl ${
              focusMode ? "hidden" : ""
            }`}
            style={
              pomodoroBackground
                ? {
                    backgroundImage: `linear-gradient(180deg, rgba(248, 251, 255, 0.88), rgba(248, 251, 255, 0.72)), url(${pomodoroBackground})`,
                    backgroundPosition: "center",
                    backgroundSize: "cover",
                  }
                : undefined
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-indigo-400">
                  Pomodoro
                </div>
                <h2 className="mt-1 text-2xl font-bold">
                  {TIMER_PRESETS[mode].label} sprint
                </h2>
              </div>

              <button
                onClick={() => setFocusMode((value) => !value)}
                className="rounded-xl border border-slate-700 bg-white px-4 py-2 font-medium hover:bg-slate-800"
              >
                {focusMode ? "Normal view" : "Focus mode"}
              </button>
            </div>

            <div className="mt-8 flex flex-col items-center text-center">
              <div className="rounded-full border-8 border-indigo-100 bg-white px-10 py-12 shadow-xl">
                <div className="text-6xl font-black text-slate-950 md:text-8xl">
                  {formatTime(secondsLeft)}
                </div>
                <div className="mt-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
                  {completedSessions} focus sessions completed
                </div>
              </div>

              <div className="mt-8 grid w-full max-w-xl grid-cols-3 gap-3">
                {(Object.keys(TIMER_PRESETS) as TimerMode[]).map((preset) => (
                  <button
                    key={preset}
                    onClick={() => switchMode(preset)}
                    className={`rounded-xl border px-3 py-3 text-sm font-semibold ${
                      mode === preset
                        ? "border-indigo-500 bg-indigo-500 text-white"
                        : "border-slate-700 bg-white hover:bg-slate-800"
                    }`}
                  >
                    {preset === "focus" ? focusMinutes : TIMER_PRESETS[preset].minutes}m
                    <span className="block text-xs font-medium opacity-75">
                      {TIMER_PRESETS[preset].label}
                    </span>
                  </button>
                ))}
              </div>

              <div className="mt-5 grid w-full max-w-xl grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
                <label className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-left">
                  <span className="block text-sm font-semibold text-indigo-300">
                    Focus minutes
                  </span>
                  <select
                    value={focusMinutes}
                    onChange={(event) => updateFocusMinutes(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-lg font-bold outline-none focus:border-indigo-500"
                  >
                    {FOCUS_MINUTE_OPTIONS.map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {minutes} minutes
                      </option>
                    ))}
                  </select>
                </label>

                <div className="flex items-stretch gap-2 md:flex-col">
                  <label className="inline-flex flex-1 cursor-pointer items-center justify-center rounded-xl bg-indigo-500 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-400 md:flex-none">
                    Background
                    <input
                      className="hidden"
                      type="file"
                      accept="image/*"
                      onChange={handleBackgroundUpload}
                    />
                  </label>
                  {pomodoroBackground && (
                    <button
                      type="button"
                      onClick={clearPomodoroBackground}
                      className="rounded-xl border border-slate-700 bg-white px-4 py-3 text-sm font-semibold hover:bg-slate-800"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <button
                  onClick={toggleTimer}
                  className="rounded-xl bg-indigo-500 px-8 py-3 font-semibold hover:bg-indigo-400"
                >
                  {running ? "Pause" : "Start"}
                </button>
                <button
                  onClick={resetTimer}
                  className="rounded-xl border border-slate-700 bg-white px-8 py-3 font-semibold hover:bg-slate-800"
                >
                  Reset
                </button>
              </div>

              <div className="mt-6 w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-950 p-4 text-left">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-indigo-300">
                      Attached mission
                    </div>
                    <div className="mt-1 text-sm text-slate-400">
                      Pomodoro focus sessions can complete one mission.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={completeAttachedMission}
                    disabled={!selectedMissionId || completingMission}
                    aria-label="Complete attached mission"
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500 font-semibold text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-4"
                  >
                    {completingMission ? (
                      <span className="lifequest-spinner light" />
                    ) : (
                      <svg
                        aria-hidden="true"
                        className="h-5 w-5"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2.5"
                        viewBox="0 0 24 24"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                    <span className="sr-only sm:not-sr-only sm:ml-2">
                      Complete
                    </span>
                  </button>
                </div>

                <select
                  value={selectedMissionId}
                  onChange={(event) => setSelectedMissionId(event.target.value)}
                  disabled={loadingMissions || completingMission}
                  className="mt-4 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-indigo-500 disabled:opacity-60"
                >
                  <option value="">
                    {loadingMissions ? "Loading missions..." : "No mission attached"}
                  </option>
                  {missions.map((mission) => (
                    <option key={mission.id} value={mission.id}>
                      {mission.title} - {mission.attribute.name}
                    </option>
                  ))}
                </select>

                {selectedMission && (
                  <div className="mt-3 rounded-xl border border-indigo-400/20 bg-indigo-500/10 p-3">
                    <div className="flex items-center gap-2 font-semibold">
                      <span>{selectedMission.attribute.icon ?? "✨"}</span>
                      <span className="min-w-0 truncate">{selectedMission.title}</span>
                    </div>
                    <div className="mt-1 text-sm text-slate-300">
                      +{selectedMission.expReward} EXP · +{selectedMission.goldReward} Gold · +{selectedMission.statReward}{" "}
                      {selectedMission.attribute.name}
                    </div>
                  </div>
                )}

                {!loadingMissions && missions.length === 0 && (
                  <div className="mt-3 text-sm text-slate-400">
                    Chưa có mission active nào để attach.
                  </div>
                )}

              </div>
            </div>
          </div>

          <aside
            className={
              focusMode
                ? "rounded-2xl border border-white/40 bg-white/90 p-3 text-slate-950 shadow-xl backdrop-blur"
                : "rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl"
            }
          >
            {!focusMode && (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-indigo-400">
                    Music
                  </div>
                  <h2 className="mt-1 text-xl font-bold">Focus playlist</h2>
                </div>
                <label
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold hover:bg-indigo-400 ${
                    uploading ? "pointer-events-none opacity-80" : ""
                  }`}
                >
                  {uploading && <span className="lifequest-spinner light" />}
                  {uploading ? "Uploading" : "Upload"}
                  <input
                    className="hidden"
                    type="file"
                    accept="audio/*"
                    disabled={uploading}
                    onChange={handleUpload}
                  />
                </label>
              </div>
            )}

            <div className="mt-5 space-y-3">
              {!focusMode && (uploading || uploadProgress > 0) && (
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                  <div className="flex items-center justify-between text-sm font-medium">
                    <span className="inline-flex items-center gap-2">
                      <span className="lifequest-spinner" />
                      {uploadProgress >= 100 ? "Processing" : "Uploading"}
                    </span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-indigo-500 transition-all duration-200"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              <select
                value={selectedTrackUrl}
                onChange={(event) => setSelectedTrackUrl(event.target.value)}
                className={`w-full rounded-xl border px-4 py-3 outline-none focus:border-indigo-500 ${
                  focusMode
                    ? "border-slate-200 bg-white"
                    : "border-slate-700 bg-slate-950"
                }`}
              >
                <option value="">No track selected</option>
                {tracks.map((track) => (
                  <option key={track.id} value={track.url}>
                    {track.name}
                  </option>
                ))}
              </select>

              <audio
                ref={audioRef}
                controls
                loop={loop}
                src={selectedTrackUrl || undefined}
                className="w-full"
              />

              {!focusMode && (
                <>
                  <label className="flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950 p-4">
                    <span className="font-medium">Volume</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={volume}
                      onChange={(event) => setVolume(Number(event.target.value))}
                      className="w-32 accent-indigo-500"
                    />
                  </label>

                  <label className="flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950 p-4">
                    <span className="font-medium">Loop music</span>
                    <input
                      type="checkbox"
                      checked={loop}
                      onChange={(event) => setLoop(event.target.checked)}
                      className="h-5 w-5 accent-indigo-500"
                    />
                  </label>

                  {selectedTrack && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
                      <div className="font-semibold">{selectedTrack.name}</div>
                      <div className="mt-1 text-sm">
                        {formatSize(selectedTrack.size)} uploaded{" "}
                        {new Date(selectedTrack.uploadedAt).toLocaleDateString()}
                      </div>
                      <div className="mt-1 text-sm">
                        Uploaded by {selectedTrack.uploadedBy.email}
                      </div>
                    </div>
                  )}
                </>
              )}
                  </div>
          </aside>
        </section>

        {!focusMode && (
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-indigo-400">
                  Library
                </div>
                <h2 className="mt-1 text-xl font-bold">Shared tracks</h2>
              </div>
              <div className="text-sm text-slate-400">
                {tracks.length} track{tracks.length === 1 ? "" : "s"}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
              {loadingTracks && (
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-5 text-slate-400">
                  <div className="inline-flex items-center gap-3">
                    <span className="lifequest-spinner" />
                    <span>Loading tracks...</span>
                  </div>
                </div>
              )}

              {!loadingTracks && tracks.length === 0 && (
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-5 text-slate-400">
                  Upload một file nhạc để bắt đầu phiên focus đầu tiên.
                </div>
              )}

              {tracks.map((track) => (
                <div
                  key={track.id}
                  className="flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950 p-4"
                >
                  <button
                    onClick={() => setSelectedTrackUrl(track.url)}
                    className="min-w-0 text-left"
                  >
                    <div className="truncate font-semibold">{track.name}</div>
                    <div className="mt-1 text-sm text-slate-400">
                      {formatSize(track.size)}
                    </div>
                    <div className="mt-1 text-sm text-slate-400">
                      Uploaded by {track.uploadedBy.email}
                    </div>
                  </button>
                  {track.canManage && (
                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => renameTrack(track)}
                        disabled={renamingTrackName === track.id}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-60"
                      >
                        {renamingTrackName === track.id && (
                          <span className="lifequest-spinner" />
                        )}
                        {renamingTrackName === track.id ? "Saving" : "Rename"}
                      </button>
                      <button
                        onClick={() => deleteTrack(track)}
                        disabled={deletingTrackName === track.id}
                        className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-white px-3 py-2 text-sm font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-60"
                      >
                        {deletingTrackName === track.id && (
                          <span className="lifequest-spinner" />
                        )}
                        {deletingTrackName === track.id
                          ? "Deleting"
                          : "Delete"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
