"use client";

import { FormEvent, useEffect, useState } from "react";
import AppHeader from "@lifequest/components/AppHeader";
import { apiFetch } from "@lifequest/lib/api";

type CalendarData = {
  year: number;
  month: number;
  summary: {
    totalCompleted: number;
    totalExp: number;
    totalGold: number;
    activeDays: number;
    totalDays: number;
    eventCount: number;
  };
  calendar: {
    date: string;
    day: number;
    weekday: number;
    completedCount: number;
    expEarned: number;
    goldEarned: number;
    statEarned: number;
    intensity: number;
    missions: {
      id: string;
      title: string;
      difficulty: string;
      attribute: {
        name: string;
        icon?: string | null;
      };
    }[];
    events: CalendarEvent[];
  }[];
};

type CalendarEvent = {
  id: string;
  title: string;
  location?: string | null;
  content?: string | null;
  startDate: string;
  endDate?: string | null;
};

function getIntensityClass(intensity: number) {
  if (intensity === 0) return "bg-white border-slate-800";
  if (intensity === 1) return "bg-emerald-50 border-emerald-200 text-emerald-900";
  if (intensity === 2) return "bg-emerald-100 border-emerald-300 text-emerald-950";
  if (intensity === 3) return "bg-emerald-200 border-emerald-400 text-emerald-950";
  return "bg-emerald-400 border-emerald-500 text-emerald-950";
}

export default function CalendarPage() {
  const [data, setData] = useState<CalendarData | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [eventTitle, setEventTitle] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [eventContent, setEventContent] = useState("");
  const [eventStartDate, setEventStartDate] = useState("");
  const [eventEndDate, setEventEndDate] = useState("");
  const [savingEvent, setSavingEvent] = useState(false);

  async function loadCalendar(targetYear = year, targetMonth = month) {
    try {
      setError("");
      const result = await apiFetch<CalendarData>(
        `/api/calendar?year=${targetYear}&month=${targetMonth}`
      );
      setData(result);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "Cannot load calendar.");
    }
  }

  useEffect(() => {
    let ignore = false;

    apiFetch<CalendarData>(`/api/calendar?year=${year}&month=${month}`)
      .then((result) => {
        if (!ignore) setData(result);
      })
      .catch((loadError) => {
        if (!ignore) {
          setError(loadError instanceof Error ? loadError.message : "Cannot load calendar.");
        }
      });

    return () => {
      ignore = true;
    };
  }, [month, year]);

  function changeMonth(offset: number) {
    let nextYear = year;
    let nextMonth = month + offset;

    if (nextMonth < 1) {
      nextMonth = 12;
      nextYear -= 1;
    }

    if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }

    setYear(nextYear);
    setMonth(nextMonth);
    loadCalendar(nextYear, nextMonth);
  }

  async function createEvent(event: FormEvent) {
    event.preventDefault();
    setSavingEvent(true);
    setError("");
    setMessage("");

    try {
      await apiFetch("/api/events", {
        method: "POST",
        body: JSON.stringify({
          title: eventTitle,
          location: eventLocation || null,
          content: eventContent || null,
          startDate: eventStartDate,
          endDate: eventEndDate || null,
        }),
      });

      setEventTitle("");
      setEventLocation("");
      setEventContent("");
      setEventStartDate("");
      setEventEndDate("");
      setMessage("Event created.");
      await loadCalendar();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Cannot create event.");
    } finally {
      setSavingEvent(false);
    }
  }

  async function updateEvent(event: CalendarEvent) {
    const title = window.prompt("Tên sự kiện", event.title);
    if (!title) return;
    const location = window.prompt("Nơi tổ chức", event.location ?? "");
    if (location === null) return;
    const content = window.prompt("Nội dung sự kiện", event.content ?? "");
    if (content === null) return;
    const startDate = window.prompt("Start date YYYY-MM-DD", event.startDate.slice(0, 10));
    if (!startDate) return;
    const endDate = window.prompt("End date YYYY-MM-DD, để trống nếu không có", event.endDate?.slice(0, 10) ?? "");
    if (endDate === null) return;

    try {
      setError("");
      setMessage("");
      await apiFetch(`/api/events/${event.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title,
          location: location || null,
          content: content || null,
          startDate,
          endDate: endDate || null,
        }),
      });
      setMessage("Event updated.");
      await loadCalendar();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Cannot update event.");
    }
  }

  async function deleteEvent(event: CalendarEvent) {
    if (!window.confirm(`Xóa event "${event.title}"?`)) return;

    try {
      setError("");
      setMessage("");
      await apiFetch(`/api/events/${event.id}`, { method: "DELETE" });
      setMessage("Event deleted.");
      await loadCalendar();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Cannot delete event.");
    }
  }

  const firstWeekday = data?.calendar[0]?.weekday ?? 0;

  return (
    <main className="min-h-screen bg-slate-950 text-white px-6 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <AppHeader title="Calendar" subtitle="Theo dõi lịch sử hoàn thành." />

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

        <section className="rounded-2xl bg-slate-900 border border-slate-800 p-6">
          <h2 className="text-xl font-bold">Create event</h2>
          <form onSubmit={createEvent} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <input
              className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"
              value={eventTitle}
              onChange={(event) => setEventTitle(event.target.value)}
              placeholder="Tên sự kiện"
              required
            />
            <input
              className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"
              value={eventLocation}
              onChange={(event) => setEventLocation(event.target.value)}
              placeholder="Nơi tổ chức"
            />
            <input
              className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"
              value={eventStartDate}
              onChange={(event) => setEventStartDate(event.target.value)}
              type="date"
              required
            />
            <input
              className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"
              value={eventEndDate}
              onChange={(event) => setEventEndDate(event.target.value)}
              type="date"
              min={eventStartDate || undefined}
            />
            <textarea
              className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 md:col-span-2"
              value={eventContent}
              onChange={(event) => setEventContent(event.target.value)}
              placeholder="Nội dung sự kiện"
              rows={3}
            />
            <button
              disabled={savingEvent}
              className="rounded-xl bg-indigo-500 py-3 font-medium hover:bg-indigo-400 disabled:opacity-50 md:col-span-2"
            >
              {savingEvent ? "Đang lưu..." : "Create event"}
            </button>
          </form>
        </section>

        <section className="rounded-2xl bg-slate-900 border border-slate-800 p-6">
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={() => changeMonth(-1)}
              className="rounded-xl border border-slate-700 px-4 py-2 hover:bg-slate-800"
            >
              ← Prev
            </button>

            <h2 className="text-xl font-bold">
              {year}-{String(month).padStart(2, "0")}
            </h2>

            <button
              onClick={() => changeMonth(1)}
              className="rounded-xl border border-slate-700 px-4 py-2 hover:bg-slate-800"
            >
              Next →
            </button>
          </div>

          {data && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="rounded-xl bg-slate-950 border border-slate-800 p-4">
                  <div className="text-sm text-slate-400">Completed</div>
                  <div className="text-2xl font-bold mt-1">
                    {data.summary.totalCompleted}
                  </div>
                </div>

                <div className="rounded-xl bg-slate-950 border border-slate-800 p-4">
                  <div className="text-sm text-slate-400">Active Days</div>
                  <div className="text-2xl font-bold mt-1">
                    {data.summary.activeDays}/{data.summary.totalDays}
                  </div>
                </div>

                <div className="rounded-xl bg-slate-950 border border-slate-800 p-4">
                  <div className="text-sm text-slate-400">EXP</div>
                  <div className="text-2xl font-bold mt-1">
                    +{data.summary.totalExp}
                  </div>
                </div>

                <div className="rounded-xl bg-slate-950 border border-slate-800 p-4">
                  <div className="text-sm text-slate-400">Gold</div>
                  <div className="text-2xl font-bold mt-1">
                    🪙 {data.summary.totalGold}
                  </div>
                </div>

                <div className="rounded-xl bg-slate-950 border border-slate-800 p-4">
                  <div className="text-sm text-slate-400">Events</div>
                  <div className="text-2xl font-bold mt-1">
                    {data.summary.eventCount}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-2 text-center text-sm text-slate-400 mb-2">
                <div>Sun</div>
                <div>Mon</div>
                <div>Tue</div>
                <div>Wed</div>
                <div>Thu</div>
                <div>Fri</div>
                <div>Sat</div>
              </div>

              <div className="grid grid-cols-7 gap-2">
                {Array.from({ length: firstWeekday }).map((_, index) => (
                  <div key={`empty-${index}`} />
                ))}

                {data.calendar.map((day) => (
                  <div
                    key={day.date}
                    title={`${day.date}: ${day.completedCount} missions`}
                    className={`min-h-24 rounded-xl border p-2 ${getIntensityClass(
                      day.intensity
                    )}`}
                  >
                    <div className="font-bold">{day.day}</div>
                    <div className="text-xs mt-1">
                      {day.completedCount > 0
                        ? `${day.completedCount} done`
                        : "—"}
                    </div>
                    <div className="text-xs mt-1 opacity-80">
                      +{day.expEarned} EXP
                    </div>
                    {day.events.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {day.events.map((event) => (
                          <button
                            key={event.id}
                            type="button"
                            onClick={() => updateEvent(event)}
                            className="block w-full truncate rounded-md bg-sky-100 px-1.5 py-1 text-left text-[11px] font-semibold text-sky-800 hover:bg-sky-200"
                            title={`${event.title}${event.location ? ` · ${event.location}` : ""}`}
                          >
                            {event.title}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-6 space-y-3">
                <h3 className="font-bold">Events this month</h3>
                {data.calendar.flatMap((day) => day.events).length === 0 ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-slate-400">
                    Chưa có event nào trong tháng này.
                  </div>
                ) : (
                  data.calendar.flatMap((day) => day.events).map((event) => (
                    <div key={event.id} className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold">{event.title}</div>
                          <div className="text-sm text-slate-400">
                            {event.startDate.slice(0, 10)}
                            {event.endDate ? ` → ${event.endDate.slice(0, 10)}` : ""} ·{" "}
                            {event.location || "No location"}
                          </div>
                          {event.content && (
                            <p className="mt-1 text-sm text-slate-300">{event.content}</p>
                          )}
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <button onClick={() => updateEvent(event)} className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800">Edit</button>
                          <button onClick={() => deleteEvent(event)} className="rounded-lg border border-red-500/30 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10">Delete</button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
