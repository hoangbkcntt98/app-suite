"use client";

type AppId = "manga-web" | "lifequest";

const apps: { id: AppId; name: string; href: string }[] = [
  { id: "manga-web", name: "Manga Web", href: "/manga-web" },
  { id: "lifequest", name: "LifeQuest", href: "/lifequest" },
];

export default function AppSelect({ current }: { current: AppId }) {
  return (
    <label className="workspace-app-select">
      <span>Ứng dụng</span>
      <select
        aria-label="Chuyển ứng dụng"
        value={current}
        onChange={(event) => {
          window.location.assign(
            apps.find((app) => app.id === event.target.value)?.href ?? "/"
          );
        }}
      >
        {apps.map((app) => (
          <option key={app.id} value={app.id}>
            {app.name}
          </option>
        ))}
      </select>
    </label>
  );
}
