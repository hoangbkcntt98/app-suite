"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [light, setLight] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem("manga-theme");
    const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
    const isLight = saved ? saved === "light" : prefersLight;
    // The DOM is the source of truth during hydration; state updates after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLight(isLight);
    document.documentElement.dataset.theme = isLight ? "light" : "dark";
  }, []);

  function toggle() {
    const next = !light;
    setLight(next);
    document.documentElement.dataset.theme = next ? "light" : "dark";
    window.localStorage.setItem("manga-theme", next ? "light" : "dark");
  }

  return (
    <button className="theme-toggle" onClick={toggle} type="button" aria-label={light ? "Switch to dark mode" : "Switch to light mode"}>
      <span aria-hidden="true">{light ? "☾" : "☀"}</span>
      {light ? "Dark" : "Light"}
    </button>
  );
}
