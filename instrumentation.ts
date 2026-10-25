import { register as registerVideoCreator } from "@video/instrumentation";

export async function register() {
  await registerVideoCreator();
}
