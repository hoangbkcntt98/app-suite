import { appPath } from "@video/lib/paths";
import { redirect } from "next/navigation";

// Preserve old bookmarks without maintaining a separate upload screen.
export default function YouTubePage() {
  redirect(appPath("/"));
}
