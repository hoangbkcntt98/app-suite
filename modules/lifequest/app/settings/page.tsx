"use client";

import { FormEvent, useEffect, useState } from "react";
import AppHeader from "@lifequest/components/AppHeader";
import { apiFetch } from "@lifequest/lib/api";

type NotificationSettings = {
  missionEnabled: boolean;
  missionTime: string;
  eventEnabled: boolean;
  eventTime: string;
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let ignore = false;

    apiFetch<{ settings: NotificationSettings }>("/api/notification-settings")
      .then((data) => {
        if (!ignore) setSettings(data.settings);
      })
      .catch((loadError) => {
        if (!ignore) {
          setError(loadError instanceof Error ? loadError.message : "Cannot load settings.");
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const result = await apiFetch<{ settings: NotificationSettings }>(
        "/api/notification-settings",
        {
          method: "PATCH",
          body: JSON.stringify(settings),
        }
      );
      setSettings(result.settings);
      setMessage("Notification settings saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Cannot save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">
      <div className="mx-auto max-w-4xl space-y-6">
        <AppHeader
          title="Settings"
          subtitle="Tùy chỉnh thời gian nhận push notifications cho mission và event."
        />

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-300">
            {error}
          </div>
        )}

        {message && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-emerald-200">
            {message}
          </div>
        )}

        {!settings ? (
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            Đang tải settings...
          </section>
        ) : (
          <form
            onSubmit={saveSettings}
            className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-6"
          >
            <section className="rounded-xl border border-slate-800 bg-slate-950 p-5 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold">Mission notifications</h2>
                  <p className="text-sm text-slate-400">Nhắc số mission còn lại trong ngày.</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.missionEnabled}
                  onChange={(event) =>
                    setSettings({ ...settings, missionEnabled: event.target.checked })
                  }
                  className="h-5 w-5"
                />
              </div>
              <label className="block space-y-2">
                <span className="text-sm text-slate-300">Notification time</span>
                <input
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3"
                  type="time"
                  value={settings.missionTime}
                  onChange={(event) =>
                    setSettings({ ...settings, missionTime: event.target.value })
                  }
                />
              </label>
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-950 p-5 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold">Event notifications</h2>
                  <p className="text-sm text-slate-400">Nhắc các event vào ngày start date.</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.eventEnabled}
                  onChange={(event) =>
                    setSettings({ ...settings, eventEnabled: event.target.checked })
                  }
                  className="h-5 w-5"
                />
              </div>
              <label className="block space-y-2">
                <span className="text-sm text-slate-300">Notification time</span>
                <input
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3"
                  type="time"
                  value={settings.eventTime}
                  onChange={(event) =>
                    setSettings({ ...settings, eventTime: event.target.value })
                  }
                />
              </label>
            </section>

            <button
              disabled={saving}
              className="w-full rounded-xl bg-indigo-500 py-3 font-medium hover:bg-indigo-400 disabled:opacity-50"
            >
              {saving ? "Đang lưu..." : "Save settings"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
