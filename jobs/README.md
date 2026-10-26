# Jobs

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

`--pattern-id` is optional; without it, the job claims the next available
grammar pattern. `--schema` overrides `job_config.create_grammar_video_jobs.schema`;
`database.schema` is fallback when neither is set. Add `--verbose` to enable
detailed DEBUG logs:

```bash
python jobs/create_grammar_video_jobs.py \
  --config jobs/app-tools/config.json \
  --schema openclaw \
  --pattern-id 7 \
  --verbose
```

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
