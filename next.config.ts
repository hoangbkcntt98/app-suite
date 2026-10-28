import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_MANGA_BASE_PATH: "/manga-web",
    NEXT_PUBLIC_LIFEQUEST_BASE_PATH: "/lifequest",
  },
  serverExternalPackages: ["archiver", "pg"],
};

export default nextConfig;
