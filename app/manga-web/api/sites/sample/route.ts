import { readFile } from "fs/promises";

const sampleConfigPath =
  process.env.MANGA_CRAWLER_SAMPLE_CONFIG ||
  "/home/opc/manga-crawler/mangarw.config.json";

export async function GET() {
  try {
    const content = await readFile(
      /*turbopackIgnore: true*/ sampleConfigPath,
      "utf8"
    );
    const config = JSON.parse(content);
    return Response.json({ ok: true, config });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Could not load sample config",
      },
      { status: 500 }
    );
  }
}
