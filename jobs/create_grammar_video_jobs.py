#!/usr/bin/env python3
"""Generate one JLPT N1 grammar video using shared app-tools helpers."""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from time import perf_counter
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
APP_TOOLS_ROOT = REPOSITORY_ROOT / "jobs" / "app-tools"
JOBS_ROOT = Path(__file__).resolve().parent
JOB_ID = "create_grammar_video_jobs"
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
from python.ai import call_api, text_to_audio, text_to_image
from python.config import load_config
from python.database import DatabasePool
from python.facebook import FacebookTool
from python.logger import get_logger
from python.video import concatenate_videos
from python.youtube import upload_video as upload_youtube_video

CONTENT_PROMPT = """Generate JLPT N1 learning content for Japanese grammar pattern 「{pattern}」.
Return only valid JSON with these required fields:
meaning_ja, meaning_vi, structure, usage_note, nuance, examples, signal, after_clause.
examples must contain exactly 3 objects with example_ja, note, and example_vi.
Use Japanese for meaning_ja, usage_note, nuance, signal, after_clause, example_ja, and note.
Use Vietnamese for meaning_vi and example_vi. Make examples natural and JLPT N1 level."""


def _safe_name(value: str, fallback: str) -> str:
    name = value.lstrip("〜～")
    name = re.sub(r'[/／\s\t\.,!?:;"\']+', "_", name)
    name = re.sub(r"_+", "_", name).strip("_")
    return name or fallback


def _resolve_job_path(value: str | Path) -> Path:
    path = Path(value).expanduser()
    if path.is_absolute():
        return path
    for base in (REPOSITORY_ROOT, JOBS_ROOT):
        candidate = base / path
        if candidate.exists():
            return candidate
    return REPOSITORY_ROOT / path


def _parse_content(response: Any) -> dict[str, Any]:
    if not isinstance(response, dict):
        raise RuntimeError("AI response must be a JSON object.")
    choices = response.get("choices")
    if not isinstance(choices, list) or not choices:
        raise RuntimeError("AI response has no choices.")
    message = choices[0].get("message", {}) if isinstance(choices[0], dict) else {}
    raw = message.get("content") if isinstance(message, dict) else None
    if not isinstance(raw, str):
        raise RuntimeError("AI response has no text content.")
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.IGNORECASE).strip()
    try:
        content = json.loads(raw)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"AI returned invalid JSON: {error}") from error
    required = ("meaning_ja", "meaning_vi", "structure", "usage_note", "nuance", "examples", "signal", "after_clause")
    if not isinstance(content, dict) or any(not content.get(key) for key in required):
        raise RuntimeError("AI content is missing required fields.")
    examples = content["examples"]
    if not isinstance(examples, list) or len(examples) != 3 or any(
        not isinstance(item, dict) or any(not item.get(key) for key in ("example_ja", "note", "example_vi"))
        for item in examples
    ):
        raise RuntimeError("AI content must contain three complete examples.")
    return content


def _parse_publish_payload(value: Any, option: str) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError(f"{option} payload must be a JSON object.")
    return value


class GrammarVideoJob:
    def __init__(self, config: dict[str, Any], schema: str | None = None):
        self.schema = schema or get_job_setting(config, JOB_ID, "database", "schema", "openclaw")
        if not isinstance(self.schema, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_$-]*", self.schema):
            raise ValueError(f"Invalid PostgreSQL schema name: {self.schema!r}")
        self.schema_prefix = f'"{self.schema}"'
        self.runs_table = runs_table(self.schema)

        self.config = get_effective_job_config(config, JOB_ID)
        database_config = self.config.get("database", {})
        database_config = dict(database_config) if isinstance(database_config, dict) else {}
        existing_options = str(database_config.get("options", "")).strip()
        database_config["options"] = f'{existing_options} -c search_path="{self.schema}",public'.strip()
        self.config["database"] = database_config
        self.logger = get_logger("grammar-video-job", self.config)
        self.logger.info("Opening PostgreSQL pool (schema=%s).", self.schema)
        self.database = DatabasePool.create(self.config)
        self.logger.info("PostgreSQL pool ready.")
        ensure_progress_column(self.database, self.schema)
        self.ensure_pattern_artifact_columns()
        self.data_dir = _resolve_job_path(get_job_setting(config, JOB_ID, "paths", "dataDir", "data"))
        self.output_dir = _resolve_job_path(get_job_setting(config, JOB_ID, "paths", "outputDir", "outputs"))
        self.run_log_dir = _resolve_job_path(
            get_job_setting(config, JOB_ID, "paths", "runLogDir", "jobs/logs/video-creator/runs")
        )
        self.date_dir = datetime.now().strftime("%Y%m%d")
        self.data_path = self.data_dir / self.date_dir
        self.output_path = self.output_dir / self.date_dir
        self.pattern: dict[str, Any] | None = None
        self.safe_name = ""
        self.run_id: int | None = None
        self.pipeline_run_id: int | None = None
        raw_pipeline_run_id = os.environ.get("VIDEO_PIPELINE_RUN_ID", "").strip()
        if raw_pipeline_run_id:
            try:
                self.pipeline_run_id = int(raw_pipeline_run_id)
            except ValueError as error:
                raise ValueError("VIDEO_PIPELINE_RUN_ID must be a positive integer.") from error
            if self.pipeline_run_id <= 0:
                raise ValueError("VIDEO_PIPELINE_RUN_ID must be a positive integer.")
        self.owns_run = self.pipeline_run_id is None
        self.run_log_path: Path | None = None
        self.video_path: str | None = None
        self.logger.debug(
            "Job configured: schema=%s data_dir=%s output_dir=%s config=%s",
            self.schema,
            self.data_dir,
            self.output_dir,
            config.get("_config_path", "provided mapping"),
        )

    def ensure_pattern_artifact_columns(self) -> None:
        self.database.execute(
            f"""ALTER TABLE {self.schema_prefix}."grammar_patterns"
                ADD COLUMN IF NOT EXISTS video_path TEXT,
                ADD COLUMN IF NOT EXISTS image_path TEXT,
                ADD COLUMN IF NOT EXISTS audio_path TEXT,
                ADD COLUMN IF NOT EXISTS caption_path TEXT,
                ADD COLUMN IF NOT EXISTS script_path TEXT,
                ADD COLUMN IF NOT EXISTS facebook_video_id TEXT,
                ADD COLUMN IF NOT EXISTS facebook_page_id TEXT,
                ADD COLUMN IF NOT EXISTS facebook_published_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS facebook_error TEXT,
                ADD COLUMN IF NOT EXISTS facebook_response JSONB,
                ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ"""
        )

    def claim_next_grammar(self, *, force: bool = False) -> dict[str, Any] | None:
        video_path_filter = (
            "TRUE" if force else "NULLIF(BTRIM(patterns.video_path), '') IS NULL"
        )
        selection = "including completed patterns" if force else "without video_path"
        self.logger.info(
            "Selecting next grammar pattern %s from schema %s.",
            selection,
            self.schema,
        )
        active_run_filter = "AND runs.id <> %s" if self.pipeline_run_id is not None else ""
        params = (self.pipeline_run_id,) if self.pipeline_run_id is not None else ()
        rows = self.database.execute(
            f"""SELECT patterns.id AS pattern_id, patterns.pattern
                FROM {self.schema_prefix}."grammar_patterns" AS patterns
                WHERE {video_path_filter}
                  AND NOT EXISTS (
                    SELECT 1
                    FROM {self.runs_table} AS runs
                    WHERE runs.object_type = 'grammar_patterns'
                      AND runs.object_id = patterns.id::text
                      AND runs.is_completed = FALSE
                      {active_run_filter}
                  )
                ORDER BY patterns.id
                LIMIT 1""",
            params,
        )
        if not rows:
            self.logger.info("No grammar patterns without video_path.")
            return None
        row = rows[0]
        if not isinstance(row, dict):
            raise RuntimeError("Database claim returned an invalid row.")
        return row

    def select_pattern(self, pattern_id: int | None, *, force: bool = False) -> None:
        if pattern_id is None:
            self.pattern = self.claim_next_grammar(force=force)
            if self.pattern is None:
                raise RuntimeError("No eligible grammar pattern available.")
        else:
            if pattern_id <= 0:
                raise ValueError("--pattern-id must be positive.")
            self.logger.info("Loading grammar pattern ID %s from schema %s.", pattern_id, self.schema)
            rows = self.database.select(
                f"{self.schema}.grammar_patterns",
                where={"id": pattern_id},
                columns=("id", "pattern"),
                limit=1,
            )
            if not rows:
                raise ValueError(f"Grammar pattern ID {pattern_id} not found.")
            row = rows[0]
            pattern_name = row.get("pattern")
            if not isinstance(pattern_name, str) or not pattern_name.strip():
                raise RuntimeError(f"Grammar pattern ID {pattern_id} has no name.")
            active_runs = self.database.execute(
                f"""SELECT 1 FROM {self.runs_table}
                    WHERE object_type = 'grammar_patterns'
                      AND object_id = %s
                      AND is_completed = FALSE
                      AND (%s::bigint IS NULL OR id <> %s)
                    LIMIT 1""",
                (str(pattern_id), self.pipeline_run_id, self.pipeline_run_id),
            )
            if active_runs:
                raise RuntimeError(f"Grammar pattern ID {pattern_id} already has an active video run.")
            self.pattern = {
                "pattern_id": int(row.get("id", pattern_id)),
                "pattern": pattern_name.strip(),
            }
        assert self.pattern is not None
        pattern_id = int(self.pattern["pattern_id"])
        self.safe_name = f"{pattern_id}_{_safe_name(str(self.pattern['pattern']), str(pattern_id))}"
        self.data_path.mkdir(parents=True, exist_ok=True)
        self.output_path.mkdir(parents=True, exist_ok=True)
        self.logger.info(
            "Selected grammar %s (ID: %s); data=%s output=%s",
            self.pattern["pattern"],
            self.pattern["pattern_id"],
            self.data_path,
            self.output_path,
        )
        if self.pipeline_run_id is not None:
            self._attach_pipeline_run()

    def _attach_pipeline_run(self) -> None:
        """Reuse the app-created run; Node owns its terminal status."""
        assert self.pattern is not None and self.pipeline_run_id is not None
        rows = self.database.execute(
            f"""SELECT id, action, object_type, object_id, is_completed, log_path, metadata
                FROM {self.runs_table}
                WHERE id = %s""",
            (self.pipeline_run_id,),
        )
        if not rows or not isinstance(rows[0], dict):
            raise RuntimeError(f"Video Creator run {self.pipeline_run_id} was not found.")
        row = rows[0]
        is_selected_run = (
            row.get("action") == "generate_pattern"
            and row.get("object_type") == "grammar_patterns"
            and str(row.get("object_id") or "") == str(self.pattern["pattern_id"])
        )
        is_next_run = (
            row.get("action") == "create_next"
            and row.get("object_type") == "grammar_patterns"
            and row.get("object_id") is None
        )
        if (
            row.get("is_completed") is not False
            or not (is_selected_run or is_next_run)
            or not row.get("log_path")
        ):
            raise RuntimeError(
                f"Video Creator run {self.pipeline_run_id} is not an active run for "
                f"grammar pattern {self.pattern['pattern_id']}."
            )
        self.run_id = self.pipeline_run_id
        self.run_log_path = Path(str(row["log_path"]))
        if is_next_run:
            self.database.execute(
                f"""UPDATE {self.runs_table}
                   SET object_id = %s,
                       metadata = COALESCE(metadata, '{{}}'::jsonb) || %s::jsonb
                   WHERE id = %s AND is_completed = FALSE""",
                (
                    str(self.pattern["pattern_id"]),
                    json.dumps({
                        "pattern_id": self.pattern["pattern_id"],
                        "pattern_name": self.pattern["pattern"],
                    }, ensure_ascii=False),
                    self.run_id,
                ),
            )
        self.logger.info(
            "Reusing Video Creator run #%s for grammar pattern_id=%s.",
            self.run_id,
            self.pattern["pattern_id"],
        )

    def generate_content(self) -> dict[str, Any]:
        assert self.pattern is not None
        ai = self.config.get("ai", {})
        chat = ai.get("chat", {}) if isinstance(ai, dict) else {}
        endpoint = str(chat.get("endpoint", "")).strip()
        if not endpoint:
            raise ValueError("Configure ai.chat.endpoint in jobs/app-tools/config.json.")
        self.logger.info(
            "Requesting grammar content from AI (pattern_id=%s, model=%s).",
            self.pattern["pattern_id"],
            chat.get("model", "unspecified"),
        )
        started_at = perf_counter()
        try:
            response = call_api(
                endpoint,
                service="chat",
                payload={
                    "model": chat.get("model"),
                    "messages": [
                        {"role": "system", "content": "You are a JLPT N1 Japanese grammar expert. Return only valid JSON."},
                        {"role": "user", "content": CONTENT_PROMPT.format(pattern=self.pattern["pattern"])},
                    ],
                    "temperature": chat.get("temperature", 0.7),
                    "max_tokens": chat.get("max_tokens", 2000),
                },
                config=self.config,
            )
        except Exception:
            self.logger.exception("AI content request failed after %.2fs.", perf_counter() - started_at)
            raise
        self.logger.info("AI content response received in %.2fs.", perf_counter() - started_at)
        content = _parse_content(response)
        content_path = self.data_path / f"{self.safe_name}_content.json"
        content_path.write_text(
            json.dumps(content, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        self.logger.info(
            "Validated AI content: %s fields, %s examples; saved %s.",
            len(content),
            len(content["examples"]),
            content_path,
        )
        self.save_learning_content(content)
        self.save_examples(int(self.pattern["pattern_id"]), content["examples"])
        self.update_pattern_artifacts(content_path=str(content_path))
        return content

    def save_learning_content(self, content: dict[str, Any]) -> None:
        assert self.pattern is not None
        self.logger.info("Saving generated learning content for pattern_id=%s.", self.pattern["pattern_id"])
        self.database.execute(
            f"""UPDATE {self.schema_prefix}."grammar_patterns"
                SET meaning_ja = %s,
                    meaning_vi = %s,
                    structure = %s,
                    usage_note = %s,
                    nuance = %s,
                    signal = %s,
                    after_clause = %s,
                    updated_at = NOW()
                WHERE id = %s""",
            (
                content["meaning_ja"],
                content["meaning_vi"],
                content["structure"],
                content["usage_note"],
                content["nuance"],
                content["signal"],
                content["after_clause"],
                self.pattern["pattern_id"],
            ),
        )
        self.logger.info("Saved generated learning content for pattern_id=%s.", self.pattern["pattern_id"])

    def save_examples(self, pattern_id: int, examples: list[dict[str, Any]]) -> None:
        if not examples:
            raise ValueError(f"No examples to save for pattern_id={pattern_id}.")
        values_sql = ", ".join(["(%s, %s, %s, %s, %s)"] * len(examples))
        params: list[Any] = []
        for display_order, example in enumerate(examples, start=1):
            params.extend((
                pattern_id,
                example["example_ja"],
                example["note"],
                example["example_vi"],
                display_order,
            ))
        self.database.execute(
            f"""WITH removed AS (
                    DELETE FROM {self.schema_prefix}."grammar_examples"
                    WHERE pattern_id = %s
                )
                INSERT INTO {self.schema_prefix}."grammar_examples"
                    (pattern_id, example_ja, note, example_vi, display_order)
                VALUES {values_sql}""",
            (pattern_id, *params),
        )
        self.logger.info("Saved %s examples for pattern_id=%s.", len(examples), pattern_id)

    def find_examples_file(self, pattern_id: int, pattern: str) -> Path | None:
        safe_name = _safe_name(pattern, pattern)
        filenames = (
            f"{pattern_id}_{safe_name}_content.json",
            f"{pattern_id}_{pattern}.json",
            f"{pattern}.json",
            f"{safe_name}_content.json",
            f"{pattern}_content.json",
        )
        date_dirs = sorted(
            (
                path for path in self.data_dir.iterdir()
                if path.is_dir() and re.fullmatch(r"\d{8}", path.name)
            ),
            key=lambda path: path.name,
            reverse=True,
        ) if self.data_dir.is_dir() else []
        for date_dir in date_dirs:
            for filename in filenames:
                candidate = date_dir / filename
                if candidate.is_file():
                    return candidate
        return None

    def sync_examples(self) -> int:
        rows = self.database.execute(
            f"""SELECT id AS pattern_id, pattern
                FROM {self.schema_prefix}."grammar_patterns"
                WHERE NULLIF(BTRIM(video_path), '') IS NOT NULL
                ORDER BY id"""
        )
        synced = 0
        for row in rows:
            pattern_id = int(row["pattern_id"])
            pattern = row["pattern"]
            example_path = self.find_examples_file(pattern_id, pattern)
            if example_path is None:
                self.logger.info(
                    "Skipping pattern_id=%s; no dated {pattern}.json or *_content.json found under %s.",
                    pattern_id,
                    self.data_dir,
                )
                continue
            try:
                payload = json.loads(example_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as error:
                self.logger.error("Skipping invalid example file %s: %s", example_path, error)
                continue
            examples = payload.get("examples") if isinstance(payload, dict) else None
            if not isinstance(examples, list) or not examples or any(
                not isinstance(item, dict)
                or any(
                    not isinstance(item.get(key), str) or not item[key].strip()
                    for key in ("example_ja", "note", "example_vi")
                )
                for item in examples
            ):
                self.logger.error(
                    "Skipping %s; examples must be a non-empty list of complete examples.",
                    example_path,
                )
                continue
            self.save_examples(pattern_id, examples)
            synced += 1
        self.logger.info("Synchronized examples for %s grammar patterns.", synced)
        return synced

    def write_scripts(self, content: dict[str, Any]) -> list[Path]:
        assert self.pattern is not None
        examples = content["examples"]
        scripts = [
            f"こんにちは。\n今日はJLPT N1文法「{self.pattern['pattern']}」を勉強します。\n\n"
            f"この文法は「{content['meaning_ja']}」。\n形は「{content['structure']}」です。\n"
            f"ポイントは、{content['usage_note']}。ニュアンスは、{content['nuance']}。",
            "例文を見てみましょう。\n\n" + "\n\n".join(
                f"{index + 1}つ目です。「{item['example_ja']}」\n{item['note']}。"
                for index, item in enumerate(examples)
            ),
            f"最後に使い方を整理しましょう。\nサインは「{content['signal']}」。\n"
            f"文型は「{content['structure']}」。\n後件では「{content['after_clause']}」。",
        ]
        paths = []
        for index, text in enumerate(scripts, 1):
            path = self.data_path / f"{self.safe_name}_script_part{index}.txt"
            path.write_text(text, encoding="utf-8")
            paths.append(path)
            self.logger.debug("Wrote script part %s: %s (%s characters).", index, path, len(text))
        caption = (
            f"{self.pattern['pattern']}\n{content['meaning_ja']}\n\n"
            f"例文：{examples[0]['example_ja']}\n\n#JLPTN1 #日本語学習 #N1文法"
        )
        caption_path = self.data_path / f"{self.safe_name}_reel_caption.txt"
        caption_path.write_text(caption, encoding="utf-8")
        self.update_pattern_artifacts(
            script_path=[str(path) for path in paths],
            caption_path=str(caption_path),
        )
        self.logger.info("Wrote %s script parts and caption %s.", len(paths), caption_path)
        return paths

    def generate_image_prompt_part1(self, content: dict[str, Any]) -> str:
        assert self.pattern is not None
        return f"""Create a vertical 9:16 educational infographic image for Japanese JLPT N1 grammar learning. Dimensions: 1080x1920 pixels.

Visual style:
- Warm cream/beige background (#FFF8E7)
- Modern rounded vector/textbook aesthetic
- Clean lines, rounded corners on all elements
- Soft shadows for depth
- Pastel color palette: navy blue (#1A365D), light pink (#FFE4E6), light blue (#DBEAFE), light yellow (#FEF3C7), light green (#D1FAE5)

Layout (top to bottom):

HEADER: Large navy text "JLPT N1 文法" centered at top

PATTERN: Large bold text 「{self.pattern['pattern']}」 in navy, centered below header

MEANING CARD: Light pink rounded rectangle card. At the top of the card, add a clearly separated pink label row with a heart icon and the large Japanese heading "意味". Place a pink dotted divider directly under this label row. Under the divider, place the Japanese text:
{content['meaning_ja']}

STRUCTURE CARD: Light blue rounded rectangle card. At the top of the card, add a clearly separated blue label row with a puzzle-piece icon and the large Japanese heading "構造". Place a blue dotted divider directly under this label row. Under the divider, place:
{content['structure']}

USAGE CARD: Light yellow rounded rectangle card. At the top of the card, add a clearly separated yellow label row with a light-bulb icon and the large Japanese heading "用法". Place a yellow dotted divider directly under this label row. Under the divider, place:
{content['usage_note']}

NUANCE CARD: Light green rounded rectangle card. At the top of the card, add a clearly separated green label row with a star icon and the large Japanese heading "ニュアンス". Place a green dotted divider directly under this label row. Under the divider, place:
{content['nuance']}

VISUAL ELEMENT: On the right side, include a friendly anime-style Japanese teacher character pointing at the cards. Character should be cute, approachable, wearing casual clothes (18~20 years old).

TEXT REQUIREMENTS:
- Japanese text only (no English except "JLPT N1")
- All text must be clearly readable on smartphone screens
- Use large, clear fonts suitable for mobile viewing
- Text should be horizontally centered in each card
- The four Japanese labels ("意味", "構造", "用法", "ニュアンス") are mandatory, large, and must never be omitted. Use the matching icon, heading color, and dotted divider for every card.

Layout spacing: Elements should be well-spaced vertically to fill the 1080x1920 canvas without overcrowding."""

    def generate_image_prompt_part2(self, content: dict[str, Any]) -> str:
        examples = content["examples"]
        return f"""Create a vertical 9:16 educational infographic image for Japanese JLPT N1 grammar examples. Dimensions: 1080x1920 pixels.

Visual style:
- Warm cream/beige background (#FFF8E7)
- Modern rounded vector/textbook aesthetic
- Clean lines, rounded corners on all elements
- Soft shadows for depth
- Pastel color palette: navy blue, light pink, light blue, light green

Layout (top to bottom):

HEADER: Large navy text "例文" centered

CARD 1 (例1): Light pink rounded rectangle card containing:
"{examples[0]['example_ja']}"
Small anime-style illustration matching this example's context (visible to the side of card)

CARD 2 (例2): Light blue rounded rectangle card containing:
"{examples[1]['example_ja']}"
Small anime-style illustration matching this example's context (visible to the side of card)

CARD 3 (例3): Light green rounded rectangle card containing:
"{examples[2]['example_ja']}"
Small anime-style illustration matching this example's context (visible to the side of card)

TEXT REQUIREMENTS:
- Japanese text only in the example cards (no English translations)
- All text must be clearly readable on smartphone screens
- Use large, clear fonts suitable for mobile viewing
- Text should be horizontally centered in each card

Layout: 3 example cards stacked vertically with good spacing between them to fill the 1080x1920 canvas evenly."""

    def generate_image_prompt_part3(self, content: dict[str, Any]) -> str:
        return f"""Create a vertical 9:16 educational infographic image for Japanese JLPT N1 grammar summary. Dimensions: 1080x1920 pixels.

Visual style:
- Warm cream/beige background (#FFF8E7)
- Modern rounded vector/textbook aesthetic
- Clean lines, rounded corners
- Soft shadows for depth
- Pastel color palette: navy blue, light pink, light blue, light green

Layout (top to bottom):

HEADER: Large navy text "まとめ" centered

FLOW DIAGRAM (vertical flow with clear arrows pointing down between each step):

STEP 1 CARD (サイン): Light pink rounded rectangle containing:
{content['signal']}

↓ (large navy arrow pointing down)

STEP 2 CARD (文型): Light blue rounded rectangle containing:
{content['structure']}

↓ (large navy arrow pointing down)

STEP 3 CARD (後件): Light green rounded rectangle containing:
{content['after_clause']}

TEXT REQUIREMENTS:
- Japanese text only (no English)
- All text must be clearly readable on smartphone screens
- Use large, clear fonts suitable for mobile viewing
- Label each step clearly: "サイン", "文型", "後件"

Visual flow: Elements arranged vertically with generous spacing and clear downward arrows to show progression. The flow should be easy to follow and fill the 1080x1920 canvas without crowding."""

    def generate_assets(
        self,
        content: dict[str, Any],
        scripts: list[Path],
    ) -> tuple[list[Path], list[Path]]:
        assert self.pattern is not None
        image_paths: list[Path] = []
        audio_paths: list[Path] = []
        ai_config = self.config.get("ai", {})
        image_config = ai_config.get("image", {}) if isinstance(ai_config, dict) else {}
        image_options = image_config.get("request_options", {}) if isinstance(image_config, dict) else {}
        image_model = image_config.get("model", "unset") if isinstance(image_config, dict) else "unset"
        self.logger.info(
            "Image tool config: model=%s endpoint=%s size=%s",
            image_model,
            image_config.get("endpoint", "unset") if isinstance(image_config, dict) else "unset",
            image_options.get("size", "default") if isinstance(image_options, dict) else "default",
        )
        prompt_builders = (
            self.generate_image_prompt_part1,
            self.generate_image_prompt_part2,
            self.generate_image_prompt_part3,
        )
        for index in range(1, 4):
            self.update_status(f"generating_image_{index}", 38 + (index - 1) * 10)
            image_path = self.data_path / f"{self.safe_name}_image_part{index}.png"
            prompt = prompt_builders[index - 1](content)
            prompt_path = self.data_path / f"{self.safe_name}_image_prompt_part{index}.txt"
            prompt_path.write_text(prompt, encoding="utf-8")
            self.logger.info(
                "Saved image prompt %s/3 (%s characters): %s",
                index,
                len(prompt),
                prompt_path,
            )
            self.logger.info("Generating image asset %s/3 with model=%s.", index, image_model)
            started_at = perf_counter()
            try:
                image_bytes = text_to_image(
                    prompt,
                    output=image_path,
                    config=self.config,
                )
            except Exception:
                self.logger.exception("Image generation failed for asset %s/3.", index)
                raise
            image_paths.append(image_path)
            self.update_pattern_artifacts(
                image_path=[str(path) for path in image_paths],
                image_prompt_paths=[
                    str(self.data_path / f"{self.safe_name}_image_prompt_part{part}.txt")
                    for part in range(1, index + 1)
                ],
            )
            self.logger.info(
                "Generated image asset %s/3 (%s bytes, %.2fs): %s",
                index,
                len(image_bytes),
                perf_counter() - started_at,
                image_path,
            )

            self.update_status(f"generating_audio_{index}", 43 + (index - 1) * 10)
            extension_setting = get_job_setting(self.config, JOB_ID, "job_config", "audio_extension")
            if extension_setting is None:
                ai_config = self.config.get("ai", {})
                audio_config = ai_config.get("audio", {}) if isinstance(ai_config, dict) else {}
                request_options = audio_config.get("request_options", {}) if isinstance(audio_config, dict) else {}
                extension_setting = (
                    request_options.get("response_format")
                    if isinstance(request_options, dict)
                    else None
                ) or "mp3"
            extension = str(extension_setting).lstrip(".")
            audio_path = self.data_path / f"{self.safe_name}_script_part{index}.{extension}"
            self.logger.info("Generating audio asset %s/3.", index)
            started_at = perf_counter()
            try:
                audio_bytes = text_to_audio(
                    scripts[index - 1].read_text(encoding="utf-8"),
                    config=self.config,
                )
            except Exception:
                self.logger.exception("Audio generation failed for asset %s/3.", index)
                raise
            audio_path.write_bytes(audio_bytes)
            audio_paths.append(audio_path)
            self.update_pattern_artifacts(audio_path=[str(path) for path in audio_paths])
            self.logger.info(
                "Generated audio asset %s/3 (%s bytes, %.2fs): %s",
                index,
                len(audio_bytes),
                perf_counter() - started_at,
                audio_path,
            )
        self.update_pattern_artifacts(
            image_path=[str(path) for path in image_paths],
            audio_path=[str(path) for path in audio_paths],
            image_prompt_paths=[
                str(self.data_path / f"{self.safe_name}_image_prompt_part{index}.txt")
                for index in range(1, 4)
            ],
        )
        return image_paths, audio_paths

    def render_video(self, image_paths: list[Path], audio_paths: list[Path]) -> Path:
        assert self.pattern is not None
        ffmpeg = str(get_job_setting(self.config, JOB_ID, "job_config", "ffmpeg_bin", "ffmpeg"))
        segments: list[Path] = []
        for index, (image, audio) in enumerate(zip(image_paths, audio_paths), 1):
            segment = self.output_path / f"{self.safe_name}_video_part{index}.mp4"
            command = [
                ffmpeg, "-y", "-loop", "1", "-i", str(image), "-i", str(audio),
                "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30",
                "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-tune", "stillimage",
                "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
                "-pix_fmt", "yuv420p", "-shortest", "-movflags", "+faststart", str(segment),
            ]
            self.logger.info("Rendering video segment %s/3: %s.", index, segment)
            started_at = perf_counter()
            try:
                subprocess.run(command, check=True, capture_output=True, text=True)
            except subprocess.CalledProcessError as error:
                self.logger.error(
                    "FFmpeg failed for segment %s (exit=%s). stdout=%s stderr=%s",
                    index,
                    error.returncode,
                    (error.stdout or "")[-2000:],
                    (error.stderr or "")[-4000:],
                )
                raise
            segments.append(segment)
            self.logger.info(
                "Rendered segment %s/3 in %.2fs (%s bytes).",
                index,
                perf_counter() - started_at,
                segment.stat().st_size if segment.exists() else 0,
            )
        output = self.output_path / f"{self.safe_name}_video.mp4"
        try:
            self.logger.info("Concatenating %s video segments.", len(segments))
            concatenate_videos(segments, output)
        except subprocess.CalledProcessError as error:
            self.logger.warning(
                "Stream-copy concatenation failed (exit=%s); retrying with re-encode. stderr=%s",
                error.returncode,
                (error.stderr or "")[-4000:],
            )
            concatenate_videos(segments, output, reencode=True)
        for segment in segments:
            segment.unlink(missing_ok=True)
        self.update_pattern_artifacts(video_path=str(output))
        return output

    def start_run(self) -> None:
        assert self.pattern is not None
        if self.pipeline_run_id is not None:
            if self.run_id is None:
                raise RuntimeError("Video Creator parent run was not validated.")
            update_progress(self.database, self.schema, self.run_id, 1)
            self.logger.info(
                "Job progress run_id=%s pattern_id=%s status=starting progress=1%%.",
                self.run_id,
                self.pattern["pattern_id"],
            )
            return
        self.run_log_dir.mkdir(parents=True, exist_ok=True)
        self.run_log_path = self.run_log_dir / (
            f"{self.safe_name}_{datetime.now().strftime('%H%M%S%f')}_{os.getpid()}_job.log"
        )
        handler = logging.FileHandler(self.run_log_path, encoding="utf-8")
        handler.setFormatter(logging.Formatter(
            "%(asctime)s %(levelname)s %(name)s: %(message)s"
        ))
        self.logger.addHandler(handler)
        self.run_id = insert_run_record(
            self.database,
            self.schema,
            action="generate_pattern",
            pattern_id=self.pattern["pattern_id"],
            pattern_name=self.pattern["pattern"],
            runner_pid=os.getpid(),
            object_type="grammar_patterns",
            object_id=str(self.pattern["pattern_id"]),
            log_path=str(self.run_log_path),
            metadata={"schema": self.schema},
        )
        self.logger.info(
            "Created run #%s for grammar pattern_id=%s (pid=%s); progress=1%%.",
            self.run_id,
            self.pattern["pattern_id"],
            os.getpid(),
        )

    def update_run_metadata(self, **values: Any) -> None:
        if self.run_id is None or not values:
            return
        self.database.execute(
            f"""UPDATE {self.runs_table}
               SET metadata = COALESCE(metadata, '{{}}'::jsonb) || %s::jsonb
               WHERE id = %s""",
            (json.dumps(values, ensure_ascii=False), self.run_id),
        )

    def update_pattern_artifacts(self, **values: Any) -> None:
        assert self.pattern is not None
        pattern_columns = {
            "video_path": "video_path",
            "image_path": "image_path",
            "audio_path": "audio_path",
            "caption_path": "caption_path",
            "script_path": "script_path",
        }
        updates = {column: values[key] for key, column in pattern_columns.items() if key in values}
        if updates:
            assignments = []
            params: list[Any] = []
            for column, value in updates.items():
                if column in {"image_path", "audio_path", "script_path"}:
                    assignments.append(f'"{column}" = %s')
                    params.append(json.dumps(value, ensure_ascii=False))
                else:
                    assignments.append(f'"{column}" = %s')
                    params.append(value)
            assignments.append("updated_at = NOW()")
            params.append(self.pattern["pattern_id"])
            self.database.execute(
                f"""UPDATE {self.schema_prefix}."grammar_patterns"
                    SET {", ".join(assignments)}
                    WHERE id = %s""",
                params,
            )

        self.update_run_metadata(**values)
        if "video_path" in values:
            self.video_path = str(values["video_path"])

    def save_facebook_result(self, result: dict[str, Any]) -> None:
        assert self.pattern is not None
        response = result.get("response")
        response = response if isinstance(response, dict) else {}
        facebook_config = self.config.get("facebook", {})
        page_id = facebook_config.get("page_id") if isinstance(facebook_config, dict) else None
        db = DatabasePool.create(self.config)
        try:
            db.execute(
                f"""UPDATE {self.schema_prefix}."grammar_patterns"
                    SET facebook_video_id = COALESCE(%s, facebook_video_id),
                        facebook_page_id = COALESCE(%s, facebook_page_id),
                        facebook_published_at = CASE WHEN %s THEN NOW() ELSE facebook_published_at END,
                        published_at = CASE WHEN %s THEN NOW() ELSE published_at END,
                        facebook_error = %s,
                        facebook_response = %s::jsonb,
                        updated_at = NOW()
                    WHERE id = %s""",
                (
                    str(response["id"]) if response.get("id") is not None else None,
                    str(page_id) if page_id is not None else None,
                    bool(result.get("success")),
                    bool(result.get("success")),
                    result.get("error"),
                    json.dumps(response, ensure_ascii=False),
                    self.pattern["pattern_id"],
                ),
            )
            if self.run_id is not None:
                db.execute(
                    f"""UPDATE {self.runs_table}
                       SET metadata = COALESCE(metadata, '{{}}'::jsonb) || %s::jsonb
                       WHERE id = %s""",
                    (json.dumps({"facebook": result}, ensure_ascii=False), self.run_id),
                )
        finally:
            db.close()

    def update_status(self, status: str, progress_percent: int | None = None) -> None:
        if self.run_id is None:
            raise RuntimeError("Cannot update run status before creating run record.")
        progress_by_status = {
            "examples_generated": 25,
            "script_generated": 35,
            "assets_generated": 75,
            "rendering_video": 80,
            "video_generated": 100,
            "content_generated": 100,
        }
        progress = progress_percent if progress_percent is not None else progress_by_status.get(status)
        if progress is not None:
            update_progress(self.database, self.schema, self.run_id, progress)
            pattern_id = self.pattern["pattern_id"] if self.pattern else None
            self.logger.info(
                "Job progress run_id=%s pattern_id=%s status=%s progress=%s%%.",
                self.run_id,
                pattern_id,
                status,
                progress,
            )
        self.logger.debug(
            "Updating run_id=%s status=%s.",
            self.run_id,
            status,
        )
        terminal = status in {"video_generated", "content_generated"}
        update_run_record(
            self.database,
            self.schema,
            self.run_id,
            stage=status,
            status=status,
            terminal=terminal,
            output_video=self.video_path,
            manage_status=self.owns_run,
        )

    def fail(self, error: str) -> None:
        if self.run_id is None:
            self.logger.debug("Skipping failure status update; no run record was created.")
            return
        self.logger.info("Marking run_id=%s as failed.", self.run_id)
        update_run_record(
            self.database,
            self.schema,
            self.run_id,
            stage="failed",
            status="failed",
            terminal=True,
            error=error[:4000],
            manage_status=self.owns_run,
        )

    def run(self, pattern_id: int | None = None, *, force: bool = False) -> Path:
        started_at = perf_counter()
        self.logger.info(
            "Grammar video job started (pattern_id=%s force=%s).",
            pattern_id or "next",
            force,
        )
        try:
            self.select_pattern(pattern_id, force=force)
            self.start_run()
            self.update_status("generating_content", 5)
            content = self.generate_content()
            self.update_status("examples_generated")
            self.update_status("writing_scripts", 30)
            scripts = self.write_scripts(content)
            self.update_status("script_generated")
            image_paths, audio_paths = self.generate_assets(content, scripts)
            self.update_status("assets_generated")
            self.update_status("rendering_video")
            output = self.render_video(image_paths, audio_paths)
            if not output.is_file() or output.stat().st_size == 0:
                raise RuntimeError("Generated video is missing or empty.")
            self.video_path = str(output)
            self.update_status("video_generated")
            self.logger.info(
                "Grammar video job completed in %.2fs: %s (%s bytes).",
                perf_counter() - started_at,
                output,
                output.stat().st_size,
            )
            return output
        except Exception as error:
            self.logger.exception("Grammar video job failed.")
            try:
                self.fail(str(error))
            except Exception:
                self.logger.exception("Could not record failed status for the selected pattern.")
            raise
        finally:
            self.logger.debug("Closing database pool.")
            self.database.close()



    def publish_video(
        self,
        video_path: Path,
        *,
        facebook_payload: dict[str, Any] | None = None,
        youtube_payload: dict[str, Any] | None = None,
    ) -> dict[str, dict[str, Any]]:
        if facebook_payload is None and youtube_payload is None:
            return {}

        caption_path = self.data_path / f"{self.safe_name}_reel_caption.txt"
        description = caption_path.read_text(encoding="utf-8") if caption_path.is_file() else ""
        title = str(self.pattern["pattern"]) if self.pattern else video_path.stem
        results: dict[str, dict[str, Any]] = {}

        if facebook_payload is not None:
            options = {"title": title, "description": description, **facebook_payload}
            self.logger.info("Uploading generated video to Facebook.")
            started_at = perf_counter()
            try:
                response = FacebookTool(config=self.config).upload_video(video_path, **options)
                results["facebook"] = {"success": True, "response": response}
                try:
                    self.save_facebook_result(results["facebook"])
                except Exception as error:
                    results["facebook"]["metadata_error"] = str(error)
                    self.logger.exception("Could not persist Facebook result to grammar_patterns.")
                self.logger.info(
                    "Facebook upload completed in %.2fs: %s",
                    perf_counter() - started_at,
                    response.get("id", "no video ID"),
                )
            except Exception as error:
                results["facebook"] = {"success": False, "error": str(error)}
                self.logger.exception("Facebook upload failed.")
                try:
                    self.save_facebook_result(results["facebook"])
                except Exception:
                    self.logger.exception("Could not persist Facebook failure to grammar_patterns.")

        if youtube_payload is not None:
            options = {"title": title, "description": description, **youtube_payload}
            self.logger.info("Uploading generated video to YouTube.")
            started_at = perf_counter()
            try:
                response = upload_youtube_video(video_path, config=self.config, **options)
                results["youtube"] = {"success": True, "response": response}
                self.logger.info(
                    "YouTube upload completed in %.2fs: %s",
                    perf_counter() - started_at,
                    response.get("id", "no video ID"),
                )
            except Exception as error:
                results["youtube"] = {"success": False, "error": str(error)}
                self.logger.exception("YouTube upload failed.")
        return results

def main() -> int:
    parser = argparse.ArgumentParser(description="Create one JLPT N1 grammar lesson video.")
    parser.add_argument("--config", help="Config JSON; defaults to COMMON_TOOLS_CONFIG or jobs/app-tools/config.json")
    parser.add_argument(
        "--schema",
        help=f"PostgreSQL schema; overrides job_config.{JOB_ID}.schema and database.schema",
    )
    parser.add_argument("--pattern-id", type=int, help="Process one grammar ID instead of claiming next")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Allow selecting a pattern with video_path and replace its generated artifacts",
    )
    parser.add_argument(
        "--sync-example",
        action="store_true",
        help="Sync examples for patterns with video_path from dataDir/YYYYmmdd/{grammar_pattern}.json",
    )
    parser.add_argument(
        "--generate_content",
        "---generate_content",
        dest="generate_content_only",
        action="store_true",
        help="Generate and save grammar content only; skip video generation",
    )
    parser.add_argument(
        "--facebook",
        type=json.loads,
        metavar="JSON",
        help="Optional Facebook upload payload, e.g. '{\"description\":\"Caption\"}'",
    )
    parser.add_argument(
        "--youtube",
        type=json.loads,
        metavar="JSON",
        help="Optional YouTube upload payload, e.g. '{\"title\":\"Grammar lesson\"}'",
    )
    parser.add_argument("--verbose", action="store_true", help="Enable DEBUG-level diagnostic logs")
    args = parser.parse_args()
    try:
        facebook_payload = _parse_publish_payload(args.facebook, "--facebook")
        youtube_payload = _parse_publish_payload(args.youtube, "--youtube")
        if args.generate_content_only and args.pattern_id is None:
            raise ValueError("--pattern-id is required with --generate_content.")
        config = load_config(args.config)
        job = GrammarVideoJob(config, schema=args.schema)
        if args.verbose:
            job.logger.setLevel(logging.DEBUG)
        if args.sync_example:
            try:
                synced = job.sync_examples()
                print(json.dumps({"success": True, "synced": synced}, ensure_ascii=False))
                return 0
            finally:
                job.database.close()
        if args.generate_content_only:
            try:
                job.select_pattern(args.pattern_id, force=args.force)
                job.start_run()
                job.update_status("generating_content", 5)
                content = job.generate_content()
                job.update_status("content_generated")
                print(json.dumps({
                    "success": True,
                    "pattern_id": job.pattern["pattern_id"] if job.pattern else None,
                    "content": content,
                }, ensure_ascii=False))
                return 0
            except Exception as error:
                try:
                    job.fail(str(error))
                except Exception:
                    job.logger.exception("Could not mark content-only run as failed.")
                raise
            finally:
                job.database.close()
        output = job.run(args.pattern_id, force=args.force)
        publish_results = job.publish_video(
            output,
            facebook_payload=facebook_payload,
            youtube_payload=youtube_payload,
        )
        publish_failed = any(not result["success"] for result in publish_results.values())
        print(json.dumps({
            "success": not publish_failed,
            "video_path": str(output),
            **publish_results,
        }, ensure_ascii=False))
        return 1 if publish_failed else 0
    except Exception as error:
        print(json.dumps({"success": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
