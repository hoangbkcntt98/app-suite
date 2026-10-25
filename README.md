# App Suite

One Next.js app for Manga Web, LifeQuest, and Video Creator.

## Routes

- `/` opens app hub.
- `/manga-web` opens Manga Web.
- `/lifequest` opens LifeQuest.
- `/video-creator` opens Video Creator.

Each module keeps its own routes, auth session, and database. Shared route names
such as `/api/auth/login` remain isolated under module prefixes.

## Setup

1. Copy `.env.example` to `.env.local`; fill database credentials and required secrets.
2. Point module connections at `app_suite_db`; use `MANGA_DB_SCHEMA=manga_db`,
   `LIFEQUEST_DATABASE_URL?schema=lifequest_db`, and
   `VIDEO_DATABASE_SCHEMA=openclaw` to select each module's schema.
3. Keep `LIFEQUEST_UPLOAD_ROOT` pointed at existing LifeQuest music uploads.
   Upload data stays outside this app.
4. Install dependencies with `npm install`.
5. Run `npm run db:generate`, `npm run lint`, and `npm run dev`.

LifeQuest Prisma commands use `LIFEQUEST_DATABASE_URL`. Video Creator tables
live in the `openclaw` schema; apply SQL migrations from
`modules/video-creator/db` to `VIDEO_DATABASE_URL`. Manga Web uses
`MANGA_DB_*`; Anki tables use the `anki` schema.

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
