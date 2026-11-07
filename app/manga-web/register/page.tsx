import { appPath } from "@manga/lib/paths";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  redirect(appPath("/login"));
}
