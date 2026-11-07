import { appPath } from "@lifequest/lib/paths";
import { redirect } from "next/navigation";

export default function RegisterPage() {
  redirect(appPath("/login"));
}
