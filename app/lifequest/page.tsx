import { appPath } from "@lifequest/lib/paths";
import AppSelect from "@/components/AppSelect";
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="lifequest-home min-h-screen bg-slate-950 text-white flex items-center justify-center px-6">
      <div className="lifequest-home-switcher">
        <AppSelect current="lifequest" />
      </div>
      <div className="max-w-xl text-center space-y-6">
        <div className="text-6xl">⚔️</div>

        <h1 className="text-4xl font-bold">LifeQuest</h1>

        <p className="text-slate-300">
          Biến thói quen tốt ngoài đời thành hành trình level up nhân vật.
        </p>

        <div className="flex gap-4 justify-center">
          <Link
            href={appPath("/register")}
            className="rounded-xl bg-indigo-500 px-6 py-3 font-medium hover:bg-indigo-400"
          >
            Bắt đầu
          </Link>

          <Link
            href={appPath("/login")}
            className="rounded-xl border border-slate-700 px-6 py-3 font-medium hover:bg-slate-800"
          >
            Đăng nhập
          </Link>
        </div>
      </div>
    </main>
  );
}
