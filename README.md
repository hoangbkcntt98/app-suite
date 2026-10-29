# App Suite

One Next.js app for Manga Web, LifeQuest, and Video Creator.

## Routes

- `/` opens app hub.
- `/manga-web` opens Manga Web.
- `/lifequest` opens LifeQuest.
- `/video-creator` opens Video Creator.
- `/batch-job-management` opens Batch Job Management.

Each app keeps its own routes and auth. Shared route names such as
`/api/auth/login` remain isolated under app prefixes.

## Setup

1. Copy `.env.example` to `.env.local`; fill database credentials and required secrets.
2. Set one `DATABASE_URL` for PostgreSQL, including `?schema=app_suite`.
   Manga Web, LifeQuest, and Video Creator use this shared connection/schema.
3. Keep `LIFEQUEST_UPLOAD_ROOT` pointed at existing LifeQuest music uploads.
   Upload data stays outside this app.
4. Install dependencies with `npm install`.
5. Run `npm run db:generate`, `npm run db:migrate`, `npm run lint`, and
   `npm run dev`.

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
   npm run db:migrate
   npm run build
   ```

3. Start App Suite on port `3000` (Nginx upstream):

   ```bash
   pm2 start npm --name app-suite --cwd /home/opc/app-suite -- start -- --port 3000
   pm2 save
   ```

4. Start the persistent schedule worker:

   ```bash
   pm2 start jobs/batch_job_scheduler.py \
     --name batch-job-scheduler \
     --interpreter /home/opc/app-suite/jobs/app-tools/.venv/bin/python \
     --cwd /home/opc/app-suite
   pm2 save
   ```

5. For later deployments, rebuild and restart:

   ```bash
   cd /home/opc/app-suite
   npm ci
   npm run db:generate
   npm run build
   pm2 restart app-suite --update-env
   pm2 save
   ```

6. Check status and logs with `pm2 status`, `pm2 logs app-suite`, and
   `pm2 logs batch-job-scheduler`.

Nginx must proxy `/`, `/_next/`, `/manga-web/`, `/lifequest/`, and
`/video-creator/` to `http://127.0.0.1:3000`. Keep each app's existing upload,
database, and other data directories outside this repository. `npm run db:migrate`
creates Batch Job Management tables in the configured schema and table names.
Video Creator SQL migrations remain separate.
# Batch Job Management

Set `BATCH_JOB_MANAGEMENT_TOKEN` and `BATCH_JOB_DEFAULT_CONFIG` in `.env`.
Default config path is `jobs/app-tools/config.json`. Set `BATCH_JOB_DB_SCHEMA`
to override the schema from `DATABASE_URL?schema=...`; set `BATCH_JOB_TABLE`
and `BATCH_JOB_RUNS_TABLE` to customize table names. Defaults are
`batch_management_jobs` and `batch_management_runs` to avoid colliding with
other apps' existing `batch_jobs` table. Run `npm run db:migrate`, then start the persistent
scheduler worker with PM2 as shown above.

Open `/batch-job-management` to create interval schedules. Select a Python file
inside `jobs/`, config file inside the repository, interval in seconds, and
arguments (one argument per line). The runner invokes the configured Python
executable directly, adds `--config <path>`, saves schedules and run progress in
PostgreSQL, and writes each run's output under `BATCH_JOB_LOG_DIR`.

