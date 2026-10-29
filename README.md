# App Suite

One Next.js app for Manga Web, LifeQuest, and Video Creator.

## Routes

- `/` opens app hub.
- `/manga-web` opens Manga Web.
- `/lifequest` opens LifeQuest.
- `/video-creator` opens Video Creator.

Each app keeps its own routes and auth session. Shared route names such as
`/api/auth/login` remain isolated under app prefixes.

## Setup

1. Copy `.env.example` to `.env.local`; fill database credentials and required secrets.
2. Set one `DATABASE_URL` for PostgreSQL, including `?schema=app_suite`.
   Manga Web, LifeQuest, and Video Creator use this shared connection/schema.
3. Keep `LIFEQUEST_UPLOAD_ROOT` pointed at existing LifeQuest music uploads.
   Upload data stays outside this app.
4. Install dependencies with `npm install`.
5. Run `npm run db:generate`, `npm run lint`, and `npm run dev`.

LifeQuest Prisma commands use `DATABASE_URL`. Video Creator tables are managed
by the Video Creator app and its jobs using the same connection. Manga Web
crawler and app also use `DATABASE_URL`; Anki integrations may still use
external Anki storage.

## WordCreator Japanese fonts

WordCreator renders Japanese text in Chromium. On Oracle Linux 9, install Noto
CJK fonts so Kanji, kana, and Japanese text do not render as empty squares:

```bash
sudo dnf install -y google-noto-sans-cjk-ttc-fonts
sudo fc-cache -f
fc-match "Noto Sans CJK JP"
```

The font package includes Japanese glyph coverage. Recreate videos rendered
before installation; existing MP4 files do not change when fonts are installed.

## WordCreator mascot GIF

Upload a replacement `spinning-bear.gif` from the WordCreator page. Uploads are
stored at `VIDEO_DATA_DIR/word-creator/assets/spinning-bear.gif` (default:
`/mnt/openclaw-data/openclaw/word-creator/assets/spinning-bear.gif`) and override
the bundled GIF for newly created videos. Accepted files must be valid GIFs,
under 15 MB, and no larger than 2048×2048. The server needs `ffprobe` available
on `PATH` to validate uploads; set `VIDEO_FFPROBE_PATH` if it is installed
elsewhere. Existing videos do not change after a GIF upload.

Video Creator requires `VIDEO_APP_AUTH_USERNAME`, `VIDEO_APP_AUTH_PASSWORD`,
and `VIDEO_APP_AUTH_SECRET`. Its `/video-creator` pages and API routes require
login, except login/logout endpoints. LifeQuest and Manga Web retain their
existing independent login flows.

## Production deployment (PM2)

1. Configure `.env.local` with production credentials and existing data paths.
   Keep this file private; do not commit it.
2. Install dependencies and build:

   ```bash
   cd /home/opc/app-suite
   npm ci
   npm run db:generate
   npm run build
   ```

3. Start App Suite on port `3000` (Nginx upstream):

   ```bash
   pm2 start npm --name app-suite --cwd /home/opc/app-suite -- start -- --port 3000
   pm2 save
   ```

4. For later deployments, rebuild and restart:

   ```bash
   cd /home/opc/app-suite
   npm ci
   npm run db:generate
   npm run build
   pm2 restart app-suite --update-env
   pm2 save
   ```

5. Check status and logs with `pm2 status` and `pm2 logs app-suite`.

Nginx must proxy `/`, `/_next/`, `/manga-web/`, `/lifequest/`, and
`/video-creator/` to `http://127.0.0.1:3000`. Keep each app's existing upload,
database, and other data directories outside this repository. Run
`npm run db:migrate` only when intentionally applying pending LifeQuest Prisma
migrations; Video Creator SQL migrations remain separate.
