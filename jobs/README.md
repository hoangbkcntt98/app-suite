# Jobs

Detailed job behavior:

- [Grammar lesson generator](create_grammar_video_jobs_readme.md)
- [Grammar example video generator](create_grammar_example_video_jobs_readme.md)
- [Manga crawler runner](manga_crawler_jobs_readme.md)

## Manga crawler job

`manga_crawler_jobs.py` runs crawler logic maintained in
`jobs/manga_crawler.py`. Web routes use this job entrypoint; crawler execution
does not depend on `/home/opc/manga-crawler/generic_manga_crawler.py`.

```bash
jobs/app-tools/.venv/bin/python -m pip install \
  -r jobs/manga_crawler_requirements.txt
jobs/app-tools/.venv/bin/python jobs/manga_crawler_jobs.py \
  --site-key mangarw-base-harem-isekai-adventure-copy \
  --chapter-id 3035582 \
  --python-bin jobs/app-tools/.venv/bin/python
```

See `manga_crawler_jobs_readme.md` for options and environment mapping.

## Grammar video job

Shared job configuration helpers live in `jobs/job_interface.py`. Each job
defines its own `JOB_ID` and uses `get_job_setting()` or
`get_effective_job_config()` so one job's overrides cannot affect another.

`create_grammar_video_jobs.py` reads settings from
`job_config.create_grammar_video_jobs` in `jobs/app-tools/config.json`. Other
jobs can keep their settings under their own job ID. Job-specific values take
precedence; missing values fall back to the matching app-tools config setting,
then to the documented default.

```json
{
  "job_config": {
    "create_grammar_video_jobs": {
      "schema": "openclaw",
      "dataDir": "data",
      "outputDir": "outputs",
      "audio_extension": "mp3",
      "ffmpeg_bin": "ffmpeg",
      "ai": {
        "image": {
          "model": "YOUR_IMAGE_MODEL"
        }
      }
    }
  }
}
```

- `dataDir`: directory for generated content JSON, scripts, images, and audio.
  Job writes files under a `YYYYMMDD` subdirectory. Falls back to `paths.dataDir`,
  then `data`.
- `schema`: PostgreSQL schema for grammar tables and functions. `--schema`
  overrides this; otherwise falls back to `database.schema`, then `default`.
- `outputDir`: directory for rendered video files. Job writes videos under a
  `YYYYMMDD` subdirectory. Falls back to `paths.outputDir`, then `outputs`.
- `audio_extension`: generated audio file extension, without or with a leading
  dot. Falls back to `ai.audio.request_options.response_format`, then `mp3`.
- `ffmpeg_bin`: FFmpeg executable name or path used to render video segments.
  Falls back to `ffmpeg`.
- `ai`: optional per-job overrides for app-tools AI settings, such as
  `ai.image.model` or `ai.image.request_options.size`. Unspecified fields
  continue using the corresponding top-level `ai` settings.

Relative paths resolve from the directory where the command runs. Install
FFmpeg and make it available through `PATH`, or set `ffmpeg_bin` to its path.
When launched from the Video Creator screen, `dataDir` and `outputDir` must
resolve to the same directories as `VIDEO_DATA_DIR` and `VIDEO_OUTPUT_DIR`.
The Next.js server needs access to this config, Python environment, and FFmpeg.

The Patterns screen has a **Run app-suite Python Job** button. It starts the
job server-side, records it in Run History, and shows its log there. Set
`VIDEO_GRAMMAR_JOB_PYTHON` to override the default
`jobs/app-tools/.venv/bin/python` executable.

Run from the repository root:

```bash
python jobs/create_grammar_video_jobs.py \
  --config jobs/app-tools/config.json \
  --schema openclaw \
  --pattern-id 7
```

`--pattern-id` is optional; without it, the job claims the next grammar
pattern without `video_path`. Add `--force` to allow selecting completed
patterns and overwrite generated files. Both modes skip patterns with an
incomplete run. `--schema` overrides
`job_config.create_grammar_video_jobs.schema`; `database.schema` is fallback
when neither is set. Add `--verbose` to enable detailed DEBUG logs:

```bash
python jobs/create_grammar_video_jobs.py \
  --config jobs/app-tools/config.json \
  --schema openclaw \
  --pattern-id 7 \
  --verbose
```

## Grammar example video job

`create_grammar_example_video_jobs.py` generates one 20-second Japanese
grammar-example video from `grammar_examples.example_ja`. It analyzes the
sentence with Chat AI, generates two consecutive 10-second clips, adds the
Japanese dialogue subtitle with FFmpeg, then validates and saves the MP4 under
`outputDir/YYYYMMDD`.

Run from the repository root:

```bash
jobs/app-tools/.venv/bin/python jobs/create_grammar_example_video_jobs.py \
  --config jobs/app-tools/config.json \
  --schema openclaw \
  --example-id 1801
```

`--example-id` and `--pattern-id` are optional filters. Add `--force` to
replace an existing output video. Configure AI chat/video/audio services under
`ai` in app-tools config; job-specific overrides belong under
`job_config.create_grammar_example_video_jobs`.

## WordCreator job

`jobs/create_word_creator_jobs.py` reads matching Anki notes, generates four
Japanese readings with `ai.chat`, renders each quiz from the WordCreator HTML
template, and saves quiz/video metadata to the Video Creator database. Configure
the database, `ai.chat`, output paths, and optional Anki database in
`jobs/app-tools/config.json`. Install Python dependencies from
`jobs/app-tools/python/requirements.txt`.
Set `job_config.create_word_creator_jobs.node_bin` and its
`paths.wordCreatorOutputDir`, `paths.templatePath`, and `paths.rendererPath`
values to select Node and WordCreator assets. `paths.audioPath` selects the WAV
track mixed into each generated video.

Run from the repository root:

```bash
jobs/app-tools/.venv/bin/python jobs/create_word_creator_jobs.py \
  --config jobs/app-tools/config.json \
  --source 生 \
  --source 行 \
  --duration 10 \
  --fps 25
```

`DATABASE_URL` selects shared database/schema; `VIDEO_ANKI_DATABASE_URL` can
override external Anki storage. `VIDEO_OUTPUT_DIR`, `VIDEO_DATA_DIR`, and
`VIDEO_WORD_CREATOR_OUTPUT_DIR` can override output paths. Add
`--fixed-fps` to disable automatic GIF FPS matching. The command exits nonzero
if any item fails.

## Grammar job watchers

Run either grammar video job repeatedly with app-tools virtualenv Python.
Each watcher has its own log, PID, interval, and lock files beside configured
`logger.file`; lock prevents overlapping runs.

Define multiple watchers in `jobs/app-tools/config.json`, using `file` for
Python filename and `args` for job-specific arguments. Each watcher can
override `config` and set optional `interval` (seconds) or `one_time` (default
false). Watcher adds `--config <path>` automatically. See `watchers` in
`jobs/app-tools/config.example.json`.

```bash
jobs/watcher.sh start --config jobs/app-tools/config.json
jobs/watcher.sh status --config jobs/app-tools/config.json
jobs/watcher.sh status --all
jobs/watcher.sh stop --all
```

For `start` and `status`, `--config` names JSON containing `watchers` and is
also passed to each Python job. `python_config` can select a different job
config; each watcher can override it with `config`. `status --config` shows
every watcher in that JSON; `status --all` shows all watcher PID files found
in the repo. `stop --all` stops all active watchers, including watchers
launched individually.

```bash
jobs/watcher.sh start create_grammar_example_video_jobs.py --one-time \
  --config jobs/app-tools/config.json --example-id 1801
jobs/watcher.sh start create_grammar_video_jobs.py --interval 10 \
  --config jobs/app-tools/config.json
jobs/watcher.sh start create_grammar_example_video_jobs.py --interval 10 \
  --config jobs/app-tools/config.json --schema openclaw --limit 10
jobs/watcher.sh status create_grammar_video_jobs.py \
  --config jobs/app-tools/config.json
jobs/watcher.sh stop create_grammar_video_jobs.py \
  --config jobs/app-tools/config.json
jobs/watcher.sh status create_grammar_example_video_jobs.py \
  --config jobs/app-tools/config.json
jobs/watcher.sh stop create_grammar_example_video_jobs.py \
  --config jobs/app-tools/config.json
```

Pass normal job options after watcher options, for example `--schema openclaw`
or `--example-id 1801`. Add `--one-time` to invoke the Python job once and exit
without waiting for another interval. Each job writes to its own
`{job_name}_watcher.log`.

## Japanese Lab game resources

`generate_game_resource.py` creates `{schema}.game_resources` and generates
Kanji Rush answer sets for `anki_kanji.RequiredVocabulary`. Correct readings
come from the matching `anki_word.Reading`, then exact kanji vocabulary
annotations as fallback. Kanji Rush `resource_id` stores matching
`anki_kanji.anki_note_id`; existing rows keyed by `anki_kanji.id` are migrated
without replacing their generated data. AI generates only the three incorrect
readings.

```bash
jobs/app-tools/.venv/bin/python jobs/generate_game_resource.py \
  --config jobs/app-tools/config.json --setup-only
jobs/watcher.sh start generate_game_resource.py --one-time \
  --config jobs/app-tools/config.json --limit 10
jobs/watcher.sh start generate_game_resource.py --interval 300 \
  --config jobs/app-tools/config.json
```

The table supports `word_blitz`, `kanji_rush`, and `grammar_sprint`; Kanji Rush
resources use `resource_table = 'anki_kanji'`. Configure distractor generation
through `ai.chat` in app-tools config. Rows with missing or stale
`resource_data` are retried on later runs.

## Optional social publishing

Without `--facebook` or `--youtube`, the job only generates the video. Pass
either option with a JSON object to publish after generation:

```bash
python jobs/create_grammar_video_jobs.py \
  --config jobs/app-tools/config.json \
  --pattern-id 7 \
  --facebook '{"description":"JLPT N1 grammar lesson"}' \
  --youtube '{"title":"JLPT N1 Grammar","tags":["JLPT","Japanese"]}'
```

Facebook payload accepts `page_id`, `description`, `title`,
`scheduled_publish_time`, and `extra_fields`. YouTube payload accepts `title`,
`description`, `tags`, `category_id`, `privacy_status`, `made_for_kids`,
`contains_synthetic_media`, and `publish_at`. Generated pattern title and reel
caption provide defaults for `title` and `description`; app-tools `facebook`
and `youtube` settings provide credentials and remaining upload defaults.

Configure per-job AI image settings under
`job_config.create_grammar_video_jobs.ai.image`. These settings override
matching `ai.image` values from app-tools; omitted values fall back to app-tools.
The job passes this merged configuration to `text_to_image()`.
