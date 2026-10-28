# `manga_crawler_jobs.py`

## Purpose

Run repository-owned crawler logic from `jobs/manga_crawler.py`. Manga Web
starts this job through `app/manga-web/lib/crawler.ts`; it no longer
launches a crawler implementation from `/home/opc/manga-crawler`.

Install crawler dependencies into the Python environment selected by
`MANGA_CRAWLER_PYTHON`:

```bash
python3 -m pip install -r jobs/manga_crawler_requirements.txt
```

## Run

```bash
jobs/app-tools/.venv/bin/python jobs/manga_crawler_jobs.py \
  --site-key mangarw-base-harem-isekai-adventure-copy \
  --crawl-images
```

Pass either `--site-key KEY` to load registered site settings from
`crawler_sites`, or `--config PATH` to load a JSON site config. Other options:

- `--manga-id ID`: crawl one local manga title.
- `--max-chapters N`: limit chapters crawled for each title.
- `--skip-title-list`: skip refreshing browse/title pages.
- `--chapter-id ID`: crawl reader images for one chapter.
- `--crawl-images`: also download/store reader images.
- `--reset`: truncate all crawler data tables; destructive.

`--python-bin`, `--env-file`, and `--log-file` override the crawler Python
runtime, optional dotenv file, and appended log path. Defaults use
`MANGA_CRAWLER_PYTHON`, `MANGA_CRAWLER_ENV_FILE`, and `MANGA_CRAWLER_LOG`.
Crawler reads the shared PostgreSQL `DATABASE_URL`; its `schema` query
parameter selects the target schema.

## Processing

1. Load optional dotenv settings without overriding the current process
   environment.
2. Map database environment variables and acquire a non-blocking lock scoped
   to a chapter, title, or global run.
3. Load site config from `crawler_sites` or JSON.
4. Optionally refresh title listings, upsert title details and chapters, and
   optionally crawl reader images.
5. Stream crawler output to stdout and append it to the configured log.
6. Return the crawler exit code and JSON result.

The crawler preserves existing retry, schema validation, DB update, image
storage, and crawl-status behavior. It does not create database schema at
runtime.
