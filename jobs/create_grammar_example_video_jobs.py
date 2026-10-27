#!/usr/bin/env python3
"""Create 20-second vertical anime videos for grammar examples."""
from __future__ import annotations

import argparse
import base64
import json
import logging
import re
import shutil
import subprocess
import sys
import tempfile
import time
import os
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
APP_TOOLS_ROOT = REPOSITORY_ROOT / "jobs" / "app-tools"
JOBS_ROOT = Path(__file__).resolve().parent
JOB_ID = "create_grammar_example_video_jobs"
if str(APP_TOOLS_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_TOOLS_ROOT))
if str(JOBS_ROOT) not in sys.path:
    sys.path.insert(0, str(JOBS_ROOT))

from job_interface import (
    get_effective_job_config,
    get_job_setting,
    ensure_progress_column,
    insert_run_record,
    runs_table,
    update_progress,
    update_run_record,
)
from python.ai import VideoTaskFailed, call_api, text_to_audio, text_to_video
from python.config import load_config
from python.database import DatabasePool
from python.logger import get_logger

SCRIPT_FIELDS = (
    "scene_context",
    "character_description",
    "video_prompt_1",
    "video_prompt_2",
    "dialogue",
    "subtitle",
)


def _parse_script(response: Any, example_jp: str) -> dict[str, str]:
    if not isinstance(response, dict):
        raise RuntimeError("Chat API response must be a JSON object.")
    choices = response.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise RuntimeError("Chat API response has no choices.")
    message = choices[0].get("message", {})
    raw = message.get("content") if isinstance(message, dict) else None
    if not isinstance(raw, str):
        raise RuntimeError("Chat API response has no message content.")
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.IGNORECASE).strip()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Chat API returned invalid JSON: {error}") from error
    if not isinstance(parsed, dict) or any(
        not isinstance(parsed.get(field), str) or not parsed[field].strip()
        for field in SCRIPT_FIELDS
    ):
        raise RuntimeError(f"Chat response must contain non-empty string fields: {SCRIPT_FIELDS}.")
    if parsed["dialogue"].strip() != example_jp or parsed["subtitle"].strip() != example_jp:
        raise RuntimeError("Chat response dialogue and subtitle must exactly match example_jp.")
    return {field: parsed[field].strip() for field in SCRIPT_FIELDS}


def _resolve_path(value: str | Path) -> Path:
    path = Path(value).expanduser()
    if path.is_absolute():
        return path
    for base in (REPOSITORY_ROOT, JOBS_ROOT):
        candidate = base / path
        if candidate.exists():
            return candidate
    return REPOSITORY_ROOT / path


def _safe_name(value: str) -> str:
    name = re.sub(r'[\\/:*?"<>|]+', "_", value).strip(" ._")
    return name or "grammar"


def _filter_path(path: Path) -> str:
    # Escape paths for FFmpeg filter arguments, including Windows-style punctuation.
    return str(path.resolve()).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def _wrap_japanese_subtitle(text: str, max_columns: int = 32) -> str:
    lines: list[str] = []
    current: list[str] = []
    width = 0
    for char in text:
        char_width = 2 if unicodedata.east_asian_width(char) in {"F", "W", "A"} else 1
        if current and width + char_width > max_columns:
            lines.append("".join(current))
            current = []
            width = 0
        current.append(char)
        width += char_width
    if current:
        lines.append("".join(current))
    return r"\N".join(lines)


def _ass_escape(text: str) -> str:
    return r"\N".join(
        part.replace("\\", r"\\").replace("{", r"\{").replace("}", r"\}")
        for part in text.split(r"\N")
    )


class GrammarExampleVideoJob:
    def __init__(self, config: dict[str, Any], schema: str | None = None):
        self.schema = schema or get_job_setting(
            config, JOB_ID, "database", "schema",
            get_job_setting(config, "create_grammar_video_jobs", "database", "schema", "openclaw"),
        )
        if not isinstance(self.schema, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_$]*", self.schema):
            raise ValueError(f"Invalid PostgreSQL schema name: {self.schema!r}")
        self.runs_table = runs_table(self.schema)
        self.config = get_effective_job_config(config, JOB_ID)
        database_config = self.config.get("database", {})
        database_config = dict(database_config) if isinstance(database_config, dict) else {}
        options = str(database_config.get("options", "")).strip()
        database_config["options"] = f"{options} -c search_path={self.schema},public".strip()
        self.config["database"] = database_config
        self.database = DatabasePool.create(self.config)
        ensure_progress_column(self.database, self.schema)
        self.database.execute(
            f'ALTER TABLE "{self.schema}"."grammar_examples" '
            "ADD COLUMN IF NOT EXISTS video_path TEXT"
        )
        self.logger = get_logger("grammar-example-video-job", self.config)
        self.ffmpeg = str(get_job_setting(
            config, JOB_ID, "job_config", "ffmpeg_bin",
            get_job_setting(config, "create_grammar_video_jobs", "job_config", "ffmpeg_bin", "ffmpeg"),
        ))
        self.output_dir = _resolve_path(get_job_setting(
            config, JOB_ID, "paths", "outputDir",
            get_job_setting(config, "create_grammar_video_jobs", "paths", "outputDir", "jobs/outputs"),
        ))
        self.output_path = self.output_dir / datetime.now().strftime("%Y%m%d")
        self.output_path.mkdir(parents=True, exist_ok=True)
        run_log_dir = get_job_setting(config, JOB_ID, "paths", "runLogDir")
        if run_log_dir is None:
            run_log_dir = get_job_setting(
                config, "create_grammar_video_jobs", "paths", "runLogDir",
                "jobs/logs/video-creator/runs",
            )
        self.run_log_dir = _resolve_path(run_log_dir)
        self.run_id: int | None = None
        self.current_example_id: int | None = None
        self.run_log_handler: logging.FileHandler | None = None
        self.max_retries = int(get_job_setting(config, JOB_ID, "job_config", "max_retries", 3))
        if self.max_retries < 1:
            raise ValueError("job_config.create_grammar_example_video_jobs.max_retries must be at least 1.")
        self.audio_extension = str(get_job_setting(
            config, JOB_ID, "job_config", "audio_extension", "mp3"
        )).strip().lstrip(".")
        if not re.fullmatch(r"[A-Za-z0-9]+", self.audio_extension):
            raise ValueError("job_config.create_grammar_example_video_jobs.audio_extension must be a file extension.")
        self.ffprobe = shutil.which("ffprobe")

    def load_examples(
        self,
        pattern_id: int | None,
        example_id: int | None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        conditions = [
            "examples.example_ja IS NOT NULL",
            "NULLIF(BTRIM(examples.example_ja), '') IS NOT NULL",
            "patterns.pattern IS NOT NULL",
            "examples.video_path IS NULL"
        ]
        params: list[Any] = []
        if pattern_id is not None:
            conditions.append("patterns.id = %s")
            params.append(pattern_id)
        if example_id is not None:
            conditions.append("examples.id = %s")
            params.append(example_id)
        limit_clause = ""
        if limit is not None:
            if limit < 1:
                raise ValueError("--limit must be a positive integer.")
            limit_clause = "LIMIT %s"
            params.append(limit)
        return self.database.execute(
            f"""SELECT examples.id AS example_id,
                       examples.pattern_id,
                       examples.display_order,
                       examples.example_ja AS example_jp,
                       examples.example_vi,
                       examples.note,
                       patterns.pattern
                FROM "{self.schema}"."grammar_examples" AS examples
                JOIN "{self.schema}"."grammar_patterns" AS patterns
                  ON patterns.id = examples.pattern_id
                WHERE {' AND '.join(conditions)}
                ORDER BY examples.pattern_id, examples.display_order NULLS LAST, examples.id
                {limit_clause}""",
            params,
        )

    def update_example_video_path(self, example_id: int, video_path: Path) -> None:
        self.database.update(
            f"{self.schema}.grammar_examples",
            {"video_path": str(video_path)},
            where={"id": example_id},
        )
        self.logger.info(
            "Updated grammar_examples.video_path example_id=%s path=%s.",
            example_id,
            video_path,
        )

    def start_run(self, row: dict[str, Any]) -> int:
        timestamp = datetime.now().strftime("%H%M%S%f")
        self.run_log_dir.mkdir(parents=True, exist_ok=True)
        log_path = self.run_log_dir / (
            f"{_safe_name(str(row['pattern']))}_{row['pattern_id']}_{timestamp}_{os.getpid()}_job.log"
        )
        handler = logging.FileHandler(log_path, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
        self.logger.addHandler(handler)
        self.run_log_handler = handler
        self.run_id = insert_run_record(
            self.database,
            self.schema,
            action="generate_pattern",
            pattern_id=row["pattern_id"],
            pattern_name=row["pattern"],
            runner_pid=os.getpid(),
            object_type="grammar_examples",
            object_id=str(row["example_id"]),
            log_path=str(log_path),
            metadata={
                "schema": self.schema,
                "job_type": JOB_ID,
                "example_id": row["example_id"],
                "display_order": row.get("display_order"),
                "job_stage": "starting",
            },
        )
        self.current_example_id = int(row["example_id"])
        self.logger.info(
            "Started example video run_id=%s example_id=%s pattern_id=%s pattern=%s display_order=%s progress=1%%.",
            self.run_id,
            row["example_id"],
            row["pattern_id"],
            row["pattern"],
            row.get("display_order"),
        )
        return self.run_id

    def set_progress(self, status: str, **metadata: Any) -> None:
        if self.run_id is None:
            return
        progress = metadata.get("progress_percent")
        if progress is not None:
            update_progress(self.database, self.schema, self.run_id, progress)
            self.logger.info(
                "Job progress run_id=%s example_id=%s status=%s progress=%s%%.",
                self.run_id,
                self.current_example_id,
                status,
                progress,
            )
        terminal = status in {"video_generated", "failed"}
        update_run_record(
            self.database,
            self.schema,
            self.run_id,
            stage=status,
            status=status,
            terminal=terminal,
            output_video=metadata.get("video_path"),
            error=metadata.get("error"),
            metadata=metadata,
        )

    def _run_with_retries(self, label: str, operation: Any) -> Any:
        for attempt in range(1, self.max_retries + 1):
            try:
                return operation()
            except Exception:
                if attempt >= self.max_retries:
                    raise
                delay = min(2 ** (attempt - 1), 15)
                self.logger.exception("%s failed (%s/%s); retrying in %ss.", label, attempt, self.max_retries, delay)
                time.sleep(delay)
        raise RuntimeError(f"{label} exhausted retries.")

    def analyze_example(self, row: dict[str, Any]) -> dict[str, str]:
        example_jp = str(row["example_jp"]).strip()
        chat = self.config.get("ai", {}).get("chat", {})
        if not isinstance(chat, dict) or not str(chat.get("endpoint", "")).strip():
            raise ValueError("Configure ai.chat.endpoint and ai.chat.model.")
        if not str(chat.get("model", "")).strip():
            raise ValueError("Configure ai.chat.model.")
        prompt = f"""Analyze Japanese grammar example and write a 20-second, 2D anime video script.
Use this exact example sentence as the meaning source. Do not rewrite it:
example_jp: {example_jp}
grammar_pattern: {row.get("pattern", "")}
Vietnamese translation for interpretation: {row.get("example_vi", "")}
Existing usage note: {row.get("note", "")}

Return JSON object only, with exactly these string fields:
scene_context, character_description, video_prompt_1, video_prompt_2, dialogue, subtitle.
Constraints:
- dialogue and subtitle must each equal example_jp exactly, character-for-character.
- depict a specific believable Japanese everyday situation that makes this sentence natural;
  avoid generic talking scenes and avoid inventing a different meaning.
- video_prompt_1 describes first 10 seconds: setup, action, and character speaking dialogue.
- video_prompt_2 describes next 10 seconds as continuation, with same named characters,
  faces, clothes, location, props, time, light, camera, and art style; show consequence/payoff.
- both prompts specify 2D anime, vertical 9:16, no generated lettering/subtitles/logos.
- video_prompt_2 must explicitly continue from the final frame of clip 1 and not reset scene.
- the named speaker says dialogue naturally in Japanese in clip 1 or 2, from its opening, with visible
  mouth movement synchronized to speech; include no additional spoken line
"""

        def request() -> dict[str, str]:
            response = call_api(
                str(chat["endpoint"]),
                service="chat",
                payload={
                    "model": chat["model"],
                    "messages": [
                        {"role": "system", "content": "Return only valid JSON matching the requested fields."},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.2,
                    "max_tokens": int(chat.get("max_tokens", 1800)),
                },
                config=self.config,
            )
            return _parse_script(response, example_jp)

        return self._run_with_retries("Chat script analysis", request)

    def _reference_image_config(self) -> tuple[str, str]:
        video_settings = self.config.get("ai", {}).get("video", {})
        if not isinstance(video_settings, dict):
            raise ValueError("Configure ai.video.")
        field = str(video_settings.get("reference_image_field", "reference_image")).strip()
        image_format = str(video_settings.get("reference_image_format", "data_uri")).strip()
        if not field:
            raise ValueError("ai.video.reference_image_field cannot be empty.")
        if image_format not in {"data_uri", "base64"}:
            raise ValueError(
                "ai.video.reference_image_format must be data_uri or base64."
            )
        return field, image_format

    def _video_config(self) -> dict[str, Any]:
        config = dict(self.config)
        ai = config.get("ai", {})
        ai = dict(ai) if isinstance(ai, dict) else {}
        video = ai.get("video", {})
        video = dict(video) if isinstance(video, dict) else {}
        model = str(video.get("model", "")).strip()
        if not model or model.startswith("YOUR_"):
            # Muse2API's VideoRequest schema provides a server-side default model.
            video.pop("model", None)
        ai["video"] = video
        config["ai"] = ai
        return config

    def _make_clip(
        self,
        script: dict[str, str],
        part: int,
        output: Path,
        *,
        reference_image: Path | None = None,
    ) -> None:
        video_settings = self.config.get("ai", {}).get("video", {})
        if not isinstance(video_settings, dict):
            raise ValueError("Configure ai.video.")
        request_options = video_settings.get("request_options", {}) if isinstance(video_settings, dict) else {}
        options = dict(request_options) if isinstance(request_options, dict) else {}
        options["duration"] = 10
        options["aspect_ratio"] = "9:16"
        prompt = (
            f"Scene context: {script['scene_context']}\n"
            f"Character continuity bible: {script['character_description']}\n"
            f"Clip {part} of 2, exactly 10 seconds. Vertical 9:16 2D anime. "
            "Silent video only: generate no dialogue, music, or sound effects. "
            "No generated text, subtitles, or logos.\n"
            f"{script[f'video_prompt_{part}']}\n"
        )
        if part == 1:
            prompt += (
                f"The character visibly articulates this exact Japanese line from the opening moment: "
                f"{script['dialogue']}. Finish within this 10-second clip, but generate no audio."
            )
        else:
            prompt += (
                "Continue from the supplied final-frame reference image. Preserve its "
                "character identity, outfit, location, framing, props, and lighting. "
                "Continue action without re-establishing or resetting the scene."
            )
        if reference_image is not None:
            field, image_format = self._reference_image_config()
            encoded = base64.b64encode(reference_image.read_bytes()).decode("ascii")
            options[field] = (
                f"data:image/png;base64,{encoded}" if image_format == "data_uri" else encoded
            )
        def progress(update: dict[str, Any]) -> None:
            remote_status = update.get("status") or update.get("phase")
            self.set_progress(
                f"clip_{part}_{remote_status}",
                clip_part=part,
                video_task_id=update.get("task_id"),
            )
        for attempt in range(1, self.max_retries + 1):
            try:
                text_to_video(
                    prompt,
                    options=options,
                    output=output,
                    config=self._video_config(),
                    progress_callback=progress,
                )
                break
            except VideoTaskFailed:
                if attempt >= self.max_retries:
                    raise
                delay = min(2 ** (attempt - 1), 15)
                self.logger.exception(
                    "Video task failed explicitly (%s/%s); submitting retry in %ss.",
                    attempt, self.max_retries, delay,
                )
                time.sleep(delay)
        if not output.is_file() or output.stat().st_size == 0:
            raise RuntimeError(f"Video API produced no clip: {output}")

    def _extract_last_frame(self, clip: Path, output: Path) -> None:
        subprocess.run([
            self.ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-sseof", "-0.05", "-i", str(clip), "-frames:v", "1", "-q:v", "2", str(output),
        ], check=True)
        if not output.is_file() or output.stat().st_size == 0:
            raise RuntimeError(f"Could not extract clip 1 final frame: {clip}")

    def _normalize_clip(self, source: Path, destination: Path) -> None:
        # Pad short provider clips with their final frame and trim long clips to ten seconds.
        subprocess.run([
            self.ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
            "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,"
                   "crop=1080:1920,fps=30,tpad=stop_mode=clone:stop_duration=10,"
                   "trim=duration=10,setpts=PTS-STARTPTS",
            "-an", "-t", "10", "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-r", "30", "-movflags", "+faststart", str(destination),
        ], check=True)

    def _render_final(
        self,
        script: dict[str, str],
        clips: list[Path],
        audio_source: Path,
        destination: Path,
    ) -> None:
        with tempfile.TemporaryDirectory(prefix="grammar-example-") as temp_name:
            temp = Path(temp_name)
            combined = temp / "combined.mp4"
            listing = temp / "clips.txt"
            listing.write_text("".join(f"file '{clip.resolve()}'\n" for clip in clips), encoding="utf-8")
            subprocess.run([
                self.ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                "-f", "concat", "-safe", "0", "-i", str(listing),
                "-c", "copy", str(combined),
            ], check=True)

            subtitle_path = temp / "captions.ass"
            wrapped_subtitle = _wrap_japanese_subtitle(script["subtitle"], max_columns=28)
            if wrapped_subtitle.replace(r"\N", "") != script["subtitle"]:
                raise RuntimeError("Subtitle line wrapping changed example_jp text.")
            line_count = wrapped_subtitle.count(r"\N") + 1
            font_size = 72 if line_count <= 2 else 64
            subtitle_path.write_text(
                "[Script Info]\n"
                "ScriptType: v4.00+\n"
                "PlayResX: 1080\n"
                "PlayResY: 1920\n"
                "WrapStyle: 2\n"
                "ScaledBorderAndShadow: yes\n"
                "\n[V4+ Styles]\n"
                "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
                "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
                "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
                "Alignment, MarginL, MarginR, MarginV, Encoding\n"
                f"Style: Example,Noto Sans CJK JP,{font_size},&H00FFFFFF,&H000000FF,"
                "&H00301808,&H80000000,-1,0,0,0,100,100,0,0,1,6,3,2,20,20,270,1\n"
                "\n[Events]\n"
                "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
                f"Dialogue: 0,0:00:00.00,0:00:10.00,Example,,0,0,0,,{_ass_escape(wrapped_subtitle)}\n",
                encoding="utf-8",
            )
            subtitle_filter = (
                f"subtitles='{_filter_path(subtitle_path)}':"
                "force_style='Alignment=2,MarginV=270'"
            )
            self.logger.info(
                "Burning exact Japanese subtitle example_id=%s duration=0-10s lines=%s font_size=%s.",
                self.current_example_id,
                line_count,
                font_size,
            )
            subprocess.run([
                self.ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                "-i", str(combined), "-i", str(audio_source),
                "-filter_complex", "[1:a]apad=whole_dur=20,atrim=0:20[a]",
                "-vf", subtitle_filter,
                "-map", "0:v:0", "-map", "[a]", "-t", "20",
                "-c:v", "libx264", "-preset", "medium", "-crf", "20",
                "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
                "-movflags", "+faststart", str(destination),
            ], check=True)

    def _probe(self, path: Path) -> dict[str, Any]:
        if not self.ffprobe:
            raise RuntimeError("ffprobe is required to verify final video and audio.")
        result = subprocess.run(
            [
                self.ffprobe, "-v", "error", "-show_streams", "-show_format",
                "-of", "json", str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        payload = json.loads(result.stdout)
        if not isinstance(payload, dict):
            raise RuntimeError(f"ffprobe returned invalid metadata for {path}.")
        return payload

    def _verify_final(self, path: Path) -> dict[str, Any]:
        info = self._probe(path)
        streams = info.get("streams", [])
        video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
        audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
        duration = float(info.get("format", {}).get("duration", 0))
        if video is None or (video.get("width"), video.get("height")) != (1080, 1920):
            raise RuntimeError("Final video is not in 1080x1920 vertical format.")
        if audio is None:
            raise RuntimeError("Final video has no dialogue audio stream.")
        if abs(duration - 20.0) > 0.5:
            raise RuntimeError(f"Final video duration is {duration:.2f}s, expected 20s.")
        return {"duration_seconds": duration, "width": video["width"], "height": video["height"]}

    def generate(self, row: dict[str, Any], *, force: bool = False) -> Path:
        stem = (
            f"{_safe_name(str(row['pattern']))}_"
            f"{int(row['example_id'])}_{int(row.get('display_order') or 0)}_example"
        )
        output = self.output_path / f"{stem}.mp4"
        if output.is_file() and not force:
            self.logger.info("Skipping existing video: %s", output)
            self.update_example_video_path(int(row["example_id"]), output)
            return output
        try:
            self.start_run(row)
            self.set_progress("analyzing_example", progress_percent=5)
            script = self.analyze_example(row)
            script_path = self.output_path / f"{stem}_script.json"
            script_path.write_text(json.dumps(script, ensure_ascii=False, indent=2), encoding="utf-8")
            self.set_progress(
                "script_ready",
                progress_percent=15,
                script_path=str(script_path),
                scene_context=script["scene_context"],
                character_description=script["character_description"],
            )
            with tempfile.TemporaryDirectory(prefix="grammar-example-clips-") as temp_name:
                temp = Path(temp_name)
                raw1 = temp / "part1-raw.mp4"
                raw2 = temp / "part2-raw.mp4"
                reference = temp / "part1-last-frame.png"
                clip1 = temp / "part1.mp4"
                clip2 = temp / "part2.mp4"
                narration = temp / f"example-audio.{self.audio_extension}"

                self.set_progress("generating_clip_1", progress_percent=20)
                self._make_clip(script, 1, raw1)

                self.set_progress("extracting_reference_frame", progress_percent=45)
                self._extract_last_frame(raw1, reference)
                self.set_progress(
                    "generating_clip_2",
                    progress_percent=50,
                    reference_frame_used=True,
                )
                self._make_clip(script, 2, raw2, reference_image=reference)

                self.set_progress("normalizing_and_joining", progress_percent=70)
                self._run_with_retries("Clip 1 normalization", lambda: self._normalize_clip(raw1, clip1))
                self._run_with_retries("Clip 2 normalization", lambda: self._normalize_clip(raw2, clip2))
                self.set_progress("generating_example_audio", progress_percent=78)
                example_jp = str(row["example_jp"]).strip()
                audio_bytes = self._run_with_retries(
                    "Japanese example audio generation",
                    lambda: text_to_audio(example_jp, config=self.config),
                )
                narration.write_bytes(audio_bytes)
                if narration.stat().st_size == 0:
                    raise RuntimeError("Audio API produced an empty Japanese example audio file.")
                self.logger.info(
                    "Generated Japanese example audio example_id=%s bytes=%s.",
                    row["example_id"],
                    narration.stat().st_size,
                )
                self.set_progress("rendering_subtitle_audio", progress_percent=80)
                self._run_with_retries(
                    "Final render",
                    lambda: self._render_final(script, [clip1, clip2], narration, output),
                )

            self.set_progress("validating_output", progress_percent=95)
            validation = self._verify_final(output)
            self.update_example_video_path(int(row["example_id"]), output)
            self.set_progress(
                "video_generated",
                progress_percent=100,
                video_path=str(output),
                validation=validation,
                reference_frame_used=True,
                subtitle_text=script["subtitle"],
                dialogue_text=script["dialogue"],
                audio_validation={
                    "stream_present": True,
                    "spoken_text_verified": False,
                    "reason": "No speech-recognition service is configured.",
                },
            )
            self.logger.info("Created verified 20-second vertical example video: %s", output)
            return output
        except Exception as error:
            self.logger.exception("Example video generation failed for example_id=%s.", row["example_id"])
            try:
                self.set_progress("failed", error=str(error))
            except Exception:
                self.logger.exception("Could not persist failed run status.")
            raise
        finally:
            self.run_id = None
            self.current_example_id = None
            if self.run_log_handler is not None:
                self.logger.removeHandler(self.run_log_handler)
                self.run_log_handler.close()
                self.run_log_handler = None

    def close(self) -> None:
        self.database.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Create 20-second vertical videos for grammar examples.")
    parser.add_argument("--config", help="Config JSON; defaults to COMMON_TOOLS_CONFIG or jobs/app-tools/config.json")
    parser.add_argument("--schema", help="PostgreSQL schema; defaults to grammar video job schema")
    parser.add_argument("--pattern-id", type=int, help="Generate examples for one grammar pattern")
    parser.add_argument("--example-id", type=int, help="Generate one grammar example")
    parser.add_argument("--limit", type=int, help="Process at most this many matching grammar examples")
    parser.add_argument("--force", action="store_true", help="Replace existing output videos")
    args = parser.parse_args()
    job: GrammarExampleVideoJob | None = None
    try:
        config = load_config(args.config)
        job = GrammarExampleVideoJob(config, schema=args.schema)
        job.logger.info(
            "Loaded grammar example video job filters pattern_id=%s example_id=%s limit=%s force=%s.",
            args.pattern_id,
            args.example_id,
            args.limit,
            args.force,
        )
        rows = job.load_examples(args.pattern_id, args.example_id, args.limit)
        job.logger.info("Found %s grammar examples to process.", len(rows))
        if not rows:
            raise RuntimeError("No matching grammar examples found.")
        results: list[str] = []
        errors: list[dict[str, Any]] = []
        for row in rows:
            try:
                results.append(str(job.generate(row, force=args.force)))
            except Exception as error:
                job.logger.error(
                    "Video generation failed example_id=%s: %s",
                    row["example_id"],
                    error,
                    exc_info=True,
                )
                errors.append({"example_id": row["example_id"], "error": str(error)})
        job.logger.info(
            "Grammar example video job finished: generated_or_existing=%s errors=%s.",
            len(results),
            len(errors),
        )
        print(json.dumps({
            "success": not errors,
            "videos": results,
            "errors": errors,
        }, ensure_ascii=False))
        return 1 if errors else 0
    except Exception as error:
        print(json.dumps({"success": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1
    finally:
        if job is not None:
            job.close()


if __name__ == "__main__":
    raise SystemExit(main())
