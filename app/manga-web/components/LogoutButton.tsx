"use client";

import { appPath } from "@manga/lib/paths";
import { useRouter } from "next/navigation";
import { apiPath } from "@manga/lib/paths";

export default function LogoutButton({
  className,
  label = "Logout",
}: {
  className?: string;
  label?: string;
}) {
  const router = useRouter();

  async function logout() {
    await fetch(apiPath("/api/auth/logout"), { method: "POST" });
    router.replace(appPath("/login"));
    router.refresh();
  }

  return (
    <button className={className} onClick={logout} type="button">
      {label}
    </button>
  );
}
