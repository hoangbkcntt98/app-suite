import { appPath } from "@manga/lib/paths";
import { redirect } from "next/navigation";
import AuthForm from "@manga/components/AuthForm";
import { getCurrentUser } from "@manga/lib/auth";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect(appPath("/"));

  return <AuthForm mode="register" />;
}
