import { register as registerVideoCreator } from "./app/video-creator/instrumentation";

export async function register() {
  await registerVideoCreator();
}
