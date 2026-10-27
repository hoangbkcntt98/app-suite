# `create_grammar_example_video_jobs.py`

## Purpose

Create a 20-second vertical anime video illustrating one JLPT N1 example
sentence stored in `grammar_examples.example_ja`. The sentence is the source of
truth for dialogue and subtitles. Chat AI builds the scene script; video AI
creates two continuous 10-second clips; FFmpeg burns the exact Japanese
sentence into the final video and validates output.

## Run

Run from repository root:

```bash
jobs/app-tools/.venv/bin/python jobs/create_grammar_example_video_jobs.py \
  --config jobs/app-tools/config.json \
  --schema openclaw \
  --example-id 1801
```

- `--example-id ID`: generate one example.
- `--pattern-id ID`: generate examples belonging to one grammar pattern.
- With neither filter, process all eligible examples.
- `--force`: regenerate and overwrite existing output MP4s.
- `--schema NAME`: override schema.
- `--config PATH`: config file; defaults to `COMMON_TOOLS_CONFIG`, then
  `jobs/app-tools/config.json`.

When a row already has an output file and `--force` is absent, job logs a skip.
Run records with `is_completed = false` prevent the same example from being
claimed concurrently.

## Configuration

Shared AI, database, and logger settings use app-tools config. Optional job
overrides live under `job_config.create_grammar_example_video_jobs`.
Settings fall back to corresponding `create_grammar_video_jobs` settings where
implemented.

- `database.schema`: default schema is `openclaw`.
- `paths.outputDir`: output root; falls back to `create_grammar_video_jobs`,
  then `jobs/outputs`.
- `job_config.ffmpeg_bin`: FFmpeg executable; falls back to
  `create_grammar_video_jobs.job_config.ffmpeg_bin`, then `ffmpeg`.
- `job_config.max_retries`: retry count for Chat AI and retryable operations;
  default `3`.
- `ai.chat`: Chat AI endpoint/model, auth, timeout, and request settings.
- `ai.video`: video endpoint/status endpoint, polling fields, credentials,
  request options, and optional `reference_image_field` /
  `reference_image_format`. If video model is empty or `YOUR_*`, helper omits
  model field so provider can use its default.

`reference_image_field` defaults to `reference_image`; format defaults to
`data_uri`. Set `reference_image_format` to `base64` if provider expects raw
base64. Provider errors are logged and returned; job does not require a
separate lip-sync capability flag.

FFmpeg, FFprobe, and an installed Japanese font (`Noto Sans CJK JP` by
default) are required. Configure logger console/file handlers in app-tools
config to trace stages and API polling.

## Processing logic

1. Query `grammar_examples` joined to `grammar_patterns`; require non-empty
   `example_ja` and pattern. Optional ID filters narrow selection.
2. Create `openclaw.runs` record per example with `object_type=grammar_examples`,
   example ID, pattern ID/name, runner PID, schema, and display order.
3. Send `example_jp`, pattern, Vietnamese translation, and note to Chat AI.
   Require JSON strings `scene_context`, `character_description`,
   `video_prompt_1`, `video_prompt_2`, `dialogue`, and `subtitle`.
   `dialogue` and `subtitle` must exactly match `example_jp`; mismatched text is
   rejected. Save validated script beside output MP4.
4. Request clip 1 with 10-second duration, 9:16 ratio, shared scene/character
   details, and exact Japanese spoken dialogue. Prompt asks for native speech
   with synchronized visible mouth movement and no extra lines.
5. Check clip 1 has an audio stream and is approximately 10 seconds. Extract
   its last frame with FFmpeg.
6. Send clip 2 prompt with that image in configured reference-image field.
   Prompt requests continuation of same characters, clothing, scene, framing,
   props, and lighting without resetting the scene.
7. Normalize both clips to 1080x1920, 30 fps, exactly 10 seconds. Normalized
   clips are video-only; final dialogue audio comes from clip 1.
8. Concatenate clips and create ASS subtitle overlay. Text is white, bold,
   large, with thick dark-blue outline and shadow, centered near lower frame.
   Japanese-aware wrapping inserts visual line breaks only; job asserts that
   removing those breaks restores exact original `example_jp`. Font size
   reduces for longer, multi-line examples. Subtitle displays during clip 1
   (0–10 seconds), when dialogue is requested.
9. Pad/trim clip 1 audio to final 20-second duration and mux with concatenated
   video and burned subtitle.
10. FFprobe must confirm 1080x1920 video, audio stream, and approximately
    20-second duration. Success stores output path, validation metadata, and
    exact dialogue/subtitle text on run record. Errors are logged, run marked
    failed, and processing continues to later selected examples.

The video API's actual voice fidelity and lip synchronization depend on provider
output; the job verifies audio-stream presence and duration, not spoken words or
mouth-sync quality.

## Progress and logs

Each run logs its ID, example/pattern IDs, progress stage, percent where
available, video task ID/status, retries, final validation, or stack trace.
Progress states include `analyzing_example`, `script_ready`,
`generating_clip_1`, video API polling states, `extracting_reference_frame`,
`generating_clip_2`, `normalizing_and_joining`,
`rendering_subtitle_audio`, `validating_output`, `video_generated`, and
`failed`. The same state and metadata are persisted into `openclaw.runs`.

## Output

Files are saved under `outputDir/YYYYMMDD`:

- Video: `{pattern}_{example_id}_{display_order}_example.mp4`
- Chat script: `{pattern}_{example_id}_{display_order}_example_script.json`

Pattern text is sanitized for filesystem use. Temporary clip files and
reference frame are removed after processing.

## Retry and failure behavior

- Chat script and retryable render operations retry up to `max_retries`, with
  exponential delays capped at 15 seconds.
- Explicit terminal video task failures are resubmitted up to `max_retries`.
- Video API HTTP/config errors, missing audio, invalid duration, failed
  reference-frame extraction, FFmpeg errors, or failed final validation mark
  that example failed.
- Command returns JSON listing generated/existing videos and per-example
  errors; exit status is non-zero if any example failed.
