# `create_grammar_video_jobs.py`

## Purpose

Generate one JLPT N1 grammar lesson video from a row in
`grammar_patterns`. The job asks Chat AI for learning content and exactly three
examples, saves that content to PostgreSQL and JSON, creates three infographic
images and three speech files, renders three vertical segments, and joins them
into one MP4. Facebook and YouTube uploads are optional.

## Run

Run from the repository root:

```bash
jobs/app-tools/.venv/bin/python jobs/create_grammar_video_jobs.py \
  --config jobs/app-tools/config.json \
  --schema openclaw \
  --pattern-id 7
```

- `--pattern-id ID`: process that grammar row. Without it, claim the lowest ID
  with no `video_path` and no incomplete run.
- `--schema NAME`: override configured PostgreSQL schema.
- `--sync-example`: sync existing examples from dated JSON files for patterns
  that already have `video_path`; does not generate a video.
- `--generate_content --pattern-id ID`: generate/save learning content and
  examples only; skip images, audio, and video.
- `--facebook JSON`: upload final MP4 using Facebook settings and optional
  per-upload overrides.
- `--youtube JSON`: upload final MP4 using YouTube settings and optional
  per-upload overrides.
- `--verbose`: enable DEBUG logging.
- `--config PATH`: config file; defaults to `COMMON_TOOLS_CONFIG`, then
  `jobs/app-tools/config.json`.

## Configuration

Job-specific values live under `job_config.create_grammar_video_jobs`.
They take precedence over shared config values; see `jobs/app-tools/config.json`
and `jobs/app-tools/config.example.json`.

- `database.schema`: schema fallback; default `openclaw`.
- `paths.dataDir`: generated JSON, scripts, prompts, images, audio, and run logs;
  default `data`.
- `paths.outputDir`: rendered lesson MP4; default `outputs`.
- `job_config.audio_extension`: generated audio extension; falls back to
  `ai.audio.request_options.response_format`, then `mp3`.
- `job_config.ffmpeg_bin`: FFmpeg executable; default `ffmpeg`.
- `ai.chat`, `ai.image`, `ai.audio`: normal app-tools service config, with
  optional job-local overrides.

Relative paths resolve from repository root unless an existing path is found
relative to `jobs/`. FFmpeg must be installed and available on `PATH`.

## Processing logic

1. Open PostgreSQL pool and ensure required artifact columns exist on
   `openclaw.runs` and `{schema}.grammar_patterns`. Artifact columns track
   video, image, audio, caption, script paths, and optional Facebook metadata.
2. Select requested grammar row or claim next eligible row. A claimed row has
   empty `video_path` and no incomplete `openclaw.runs` entry for that pattern.
3. Create a run record in `openclaw.runs`, with pattern ID, PID, schema, and a
   per-run log under the dated data directory.
4. Call Chat AI with `CONTENT_PROMPT`. Response must be valid JSON containing
   `meaning_ja`, `meaning_vi`, `structure`, `usage_note`, `nuance`, `examples`,
   `signal`, and `after_clause`. `examples` must contain exactly three complete
   objects: `example_ja`, `note`, and `example_vi`.
5. Save content as
   `{pattern_id}_{safe_pattern}_content.json`; update learning fields in
   `grammar_patterns`; replace existing examples for this pattern and insert
   the three new rows with `display_order` 1, 2, and 3.
6. Write three Japanese narration scripts and one reel caption. Save script and
   caption paths into the pattern row and run metadata.
7. For each part, save the generated infographic prompt, call app-tools
   `text_to_image()` and `text_to_audio()`, and persist PNG/audio assets and
   their paths. Image prompts cover grammar meaning/structure/usage/nuance,
   three examples, and summary.
8. Use FFmpeg to create three 1080x1920, 30 fps MP4 segments from still image
   plus audio. Concatenate segments; if stream-copy concat fails, retry with
   re-encoding. Remove intermediate segment files after successful concat.
9. Require non-empty final MP4, update `grammar_patterns.video_path`, and mark
   run `video_generated`. On failure, log stack trace, mark run failed, then
   return non-zero.
10. If requested, upload the MP4 after generation. Facebook result and response
    metadata are persisted to `grammar_patterns`/run metadata. Upload failures
    appear in the JSON result and make command exit non-zero.

Run statuses progress through `starting`, `examples_generated`,
`script_generated`, `assets_generated`, and `video_generated`; errors set
`failed`. The logger writes shared logs and a per-run log.

## Files

All generated files use current date directory `YYYYMMDD`.

- Content: `{id}_{safe_pattern}_content.json`
- Scripts: `{id}_{safe_pattern}_script_part1.txt` through `part3.txt`
- Caption: `{id}_{safe_pattern}_reel_caption.txt`
- Image prompts: `{id}_{safe_pattern}_image_prompt_part1.txt` through `part3.txt`
- Images: `{id}_{safe_pattern}_image_part1.png` through `part3.png`
- Audio: `{id}_{safe_pattern}_script_part1.{ext}` through `part3.{ext}`
- Video: `{id}_{safe_pattern}_video.mp4`
- Run log: `{id}_{safe_pattern}_{time}_{pid}_job.log`

`safe_pattern` sanitizes characters unsafe in filenames. Database artifact
columns contain paths; image/audio/script paths are stored as JSON arrays.

## Example synchronization

`--sync-example` selects grammar patterns where `video_path` is non-empty.
For each, it searches dated directories under `paths.dataDir`, newest first,
for these names, in order:

1. `{pattern_id}_{safe_pattern}_content.json`
2. `{pattern_id}_{pattern}.json`
3. `{pattern}.json`
4. `{safe_pattern}_content.json`
5. `{pattern}_content.json`

The selected file must contain non-empty `examples`; each item must include
non-empty `example_ja`, `note`, and `example_vi`. Existing DB examples for that
pattern are replaced. Missing/invalid files are logged and skipped. Command
prints JSON with `success` and number of synchronized patterns.

## Publishing

Example:

```bash
jobs/app-tools/.venv/bin/python jobs/create_grammar_video_jobs.py \
  --pattern-id 7 \
  --facebook '{"description":"JLPT N1 grammar"}' \
  --youtube '{"title":"JLPT N1 Grammar","tags":["JLPT","Japanese"]}'
```

Generated caption and pattern name provide upload defaults. Credentials and
remaining provider options come from shared `facebook` and `youtube` config.
No publishing flags means generation only.
