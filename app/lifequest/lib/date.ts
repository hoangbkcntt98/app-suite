export function getTodayInTokyoDateOnly() {
  const now = new Date();

  const tokyoDateString = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  return new Date(`${tokyoDateString}T00:00:00.000Z`);
}

export function getDateOnlyInTokyo(date: Date) {
  const tokyoDateString = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

  return new Date(`${tokyoDateString}T00:00:00.000Z`);
}

export function addDaysUTC(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function startOfDateUTC(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

export function getLastNDaysInTokyo(days: number) {
  const today = getTodayInTokyoDateOnly();

  return Array.from({ length: days }).map((_, index) => {
    const offset = index - (days - 1);
    return addDaysUTC(today, offset);
  });
}

export function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function getCurrentTimeInTokyoHHMM() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";

  return `${hour}:${minute}`;
}

export function parseDateOnlyUTC(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}
