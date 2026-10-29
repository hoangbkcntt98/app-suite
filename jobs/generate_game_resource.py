#!/usr/bin/env python3
"""Generate quiz resources for Japanese Lab games."""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "jobs" / "app-tools"
sys.path.insert(0, str(TOOLS))
sys.path.insert(0, str(ROOT / "jobs"))

from job_interface import get_effective_job_config, get_job_setting
from python.config import load_config
from python.logger import get_logger

try:
    import psycopg
    import requests
    from psycopg.rows import dict_row
except ImportError as error:
    raise RuntimeError("Install jobs/app-tools/python/requirements.txt first.") from error

JOB_ID = "generate_game_resource"
GAME_TYPE = "kanji_rush"
RESOURCE_TABLE = "anki_kanji"
READING_PATTERN = re.compile(r"[（(]([^（）()]+)[）)]")
JAPANESE_READING_PATTERN = re.compile(r"^[ぁ-ゖァ-ヺー・]+$")


def quote_schema(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_$-]*", value):
        raise ValueError(f"Invalid PostgreSQL schema name: {value!r}")
    return f'"{value}"'


def database_settings(config: dict[str, Any]) -> tuple[dict[str, Any], str]:
    settings = dict(config.get("database", {}))
    database_url = os.environ.get("DATABASE_URL", "").strip()
    schema = ""
    if database_url:
        parsed = urlparse(database_url)
        if parsed.scheme not in {"postgres", "postgresql"}:
            raise ValueError("DATABASE_URL must use PostgreSQL.")
        settings.update({
            "driver": "postgresql",
            "host": parsed.hostname,
            "port": parsed.port or 5432,
            "dbname": parsed.path.lstrip("/"),
            "user": unquote(parsed.username or ""),
            "password": unquote(parsed.password or ""),
        })
        schema = parse_qs(parsed.query).get("schema", [""])[0]
        sslmode = parse_qs(parsed.query).get("sslmode", [""])[0]
        if sslmode:
            settings["sslmode"] = sslmode
    schema = schema or str(
        get_job_setting(config, JOB_ID, "database", "schema", "app_suite")
    )
    return settings, schema


def reading_from_vocabulary_fields(row: dict[str, Any]) -> str | None:
    word = str(row.get("required_vocabulary") or "").strip()
    for index in range(1, 7):
        value = str(row.get(f"vocabulary{index}_jp") or "")
        match = READING_PATTERN.search(value)
        if match and value.split("（", 1)[0].split("(", 1)[0].strip() == word:
            reading = match.group(1).strip()
            if JAPANESE_READING_PATTERN.fullmatch(reading):
                return reading
    return None


def validate_wrong_readings(values: Any, correct_reading: str) -> list[str]:
    if not isinstance(values, list) or len(values) != 3:
        raise ValueError("AI must return exactly three wrong readings.")
    readings = [value.strip() for value in values if isinstance(value, str)]
    if len(readings) != 3 or any(not JAPANESE_READING_PATTERN.fullmatch(value) for value in readings):
        raise ValueError("AI readings must be non-empty kana.")
    if len(set(readings)) != 3 or correct_reading in readings:
        raise ValueError("AI readings must be distinct and must not match correct reading.")
    return readings


class GameResourceJob:
    def __init__(self, config: dict[str, Any], limit: int | None = None):
        self.config = get_effective_job_config(config, JOB_ID)
        self.logger = get_logger("generate-game-resource", self.config)
        self.limit = limit
        settings, self.schema = database_settings(config)
        self.schema_sql = quote_schema(self.schema)
        keys = ("host", "port", "dbname", "user", "password", "sslmode", "options")
        kwargs = {key: settings[key] for key in keys if settings.get(key) is not None}
        self.database = psycopg.connect(**kwargs, row_factory=dict_row)

        chat = self.config.get("ai", {}).get("chat", {})
        self.base_url = str(chat.get("base_url", "")).strip().rstrip("/")
        self.endpoint = str(chat.get("endpoint", "/chat/completions")).strip()
        self.model = str(chat.get("model", "")).strip()
        self.api_key = str(chat.get("api_key", "")).strip()
        if not self.api_key and chat.get("api_key_env"):
            self.api_key = os.environ.get(str(chat["api_key_env"]), "").strip()
        self.timeout = float(chat.get("timeout_seconds", 120))
        self.temperature = float(chat.get("temperature", 0.3))
        self.max_tokens = int(chat.get("max_tokens", 500))
        self.auth_header = str(chat.get("api_key_header", "Authorization"))
        self.auth_scheme = str(chat.get("auth_scheme", "Bearer")).strip()

        self.ensure_schema()

    def ensure_schema(self) -> None:
        with self.database.cursor() as cursor:
            cursor.execute(f"""CREATE TABLE IF NOT EXISTS {self.schema_sql}.game_resources (
              id BIGSERIAL PRIMARY KEY,
              game_type TEXT NOT NULL CHECK (game_type IN ('word_blitz', 'kanji_rush', 'grammar_sprint')),
              resource_id BIGINT NOT NULL,
              resource_table TEXT NOT NULL,
              resource_data JSONB,
              last_error TEXT,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              UNIQUE (game_type, resource_table, resource_id)
            )""")
            cursor.execute(f"""CREATE INDEX IF NOT EXISTS game_resources_type_table_idx
              ON {self.schema_sql}.game_resources (game_type, resource_table)""")
            cursor.execute(f"""UPDATE {self.schema_sql}.game_resources r
              SET resource_id = k.anki_note_id, updated_at = NOW()
              FROM {self.schema_sql}.anki_kanji k
              WHERE r.game_type = %s AND r.resource_table = %s
                AND r.resource_id = k.id
                AND k.anki_note_id IS NOT NULL
                AND r.resource_id <> k.anki_note_id
                AND NOT EXISTS (
                  SELECT 1 FROM {self.schema_sql}.game_resources current
                  WHERE current.game_type = r.game_type
                    AND current.resource_table = r.resource_table
                    AND current.resource_id = k.anki_note_id
                    AND current.id <> r.id
                )
                AND (
                  r.resource_data IS NULL OR
                  r.resource_data->>'requiredVocabulary' IS NOT DISTINCT FROM BTRIM(k."RequiredVocabulary")
                )""", (GAME_TYPE, RESOURCE_TABLE))
        self.database.commit()

    def source_rows(self) -> list[dict[str, Any]]:
        limit_sql = "LIMIT %s" if self.limit is not None else ""
        params = [GAME_TYPE, RESOURCE_TABLE]
        if self.limit is not None:
            params.append(self.limit)
        with self.database.cursor() as cursor:
            cursor.execute(f"""INSERT INTO {self.schema_sql}.game_resources
                (game_type, resource_id, resource_table)
              SELECT %s, k.anki_note_id, %s
              FROM {self.schema_sql}.anki_kanji k
              WHERE k.anki_note_id IS NOT NULL
                AND NULLIF(BTRIM(k."RequiredVocabulary"), '') IS NOT NULL
              ON CONFLICT (game_type, resource_table, resource_id) DO NOTHING""",
              (GAME_TYPE, RESOURCE_TABLE))
            cursor.execute(f"""SELECT k.anki_note_id AS resource_id,
                  BTRIM(k."RequiredVocabulary") AS required_vocabulary,
                  k."Kanji" AS kanji,
                  k."OnYomi" AS on_yomi,
                  k."KunYomi" AS kun_yomi,
                  k."MeaningVI" AS meaning_vi,
                  k."Vocabulary1_JP" AS vocabulary1_jp,
                  k."Vocabulary2_JP" AS vocabulary2_jp,
                  k."Vocabulary3_JP" AS vocabulary3_jp,
                  k."Vocabulary4_JP" AS vocabulary4_jp,
                  k."Vocabulary5_JP" AS vocabulary5_jp,
                  k."Vocabulary6_JP" AS vocabulary6_jp,
                  k."Example1_JP" AS example1_ja, k."Example1_VN" AS example1_vi,
                  k."Example2_JP" AS example2_ja, k."Example2_VN" AS example2_vi,
                  k."Example3_JP" AS example3_ja, k."Example3_VN" AS example3_vi,
                  k."Example4_JP" AS example4_ja, k."Example4_VN" AS example4_vi,
                  k."Example5_JP" AS example5_ja, k."Example5_VN" AS example5_vi,
                  k."Example6_JP" AS example6_ja, k."Example6_VN" AS example6_vi,
                  w."Reading" AS dictionary_reading
                FROM {self.schema_sql}.anki_kanji k
                JOIN {self.schema_sql}.game_resources r
                  ON r.game_type = %s AND r.resource_table = %s AND r.resource_id = k.anki_note_id
                LEFT JOIN LATERAL (
                  SELECT aw."Reading"
                  FROM {self.schema_sql}.anki_word aw
                  WHERE BTRIM(aw."Word") = BTRIM(k."RequiredVocabulary")
                    AND NULLIF(BTRIM(aw."Reading"), '') IS NOT NULL
                  ORDER BY aw.updated_at DESC NULLS LAST, aw.id DESC
                  LIMIT 1
                ) w ON TRUE
                WHERE NULLIF(BTRIM(k."RequiredVocabulary"), '') IS NOT NULL
                  AND k.anki_note_id IS NOT NULL
                  AND (r.resource_data IS NULL OR
                    r.resource_data->>'requiredVocabulary' IS DISTINCT FROM BTRIM(k."RequiredVocabulary"))
                ORDER BY k.id {limit_sql}""", tuple(params))
            rows = list(cursor.fetchall())
        self.database.commit()
        return rows

    def correct_reading(self, row: dict[str, Any]) -> str:
        reading = str(row.get("dictionary_reading") or "").strip()
        if not reading:
            reading = reading_from_vocabulary_fields(row) or ""
        if not JAPANESE_READING_PATTERN.fullmatch(reading):
            raise ValueError("No valid reading found for RequiredVocabulary.")
        return reading

    def generate_wrong_readings(self, row: dict[str, Any], correct: str) -> list[str]:
        if not all((self.base_url, self.model, self.api_key)):
            raise ValueError("Configure ai.chat.base_url, model, and api_key (or api_key_env).")
        payload = {
            "model": self.model,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "stream": False,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": "Create Japanese multiple-choice distractors. Return JSON only.",
                },
                {
                    "role": "user",
                    "content": "\n".join((
                        f"Kanji: {row.get('kanji') or ''}",
                        f"RequiredVocabulary: {row['required_vocabulary']}",
                        f"Correct reading (do not include): {correct}",
                        "Return JSON exactly as {\"wrongReadings\":[\"...\",\"...\",\"...\"]}.",
                        "Provide exactly 3 distinct, plausible but incorrect Japanese kana readings.",
                        "Do not include the correct reading. Do not include explanations or punctuation.",
                    )),
                },
            ],
        }
        headers = {
            self.auth_header: f"{self.auth_scheme} {self.api_key}".strip(),
            "Accept": "application/json, text/event-stream",
        }
        last_error: Exception | None = None
        for attempt in range(2):
            try:
                response = requests.post(
                    f"{self.base_url}/{self.endpoint.lstrip('/')}",
                    headers=headers,
                    json=payload,
                    timeout=self.timeout,
                )
                response.raise_for_status()
                raw = response.json()["choices"][0]["message"]["content"].strip()
                raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.IGNORECASE).strip()
                parsed = json.loads(raw)
                return validate_wrong_readings(parsed.get("wrongReadings"), correct)
            except Exception as error:
                last_error = error
                if attempt == 0:
                    time.sleep(0.5)
        raise RuntimeError(f"AI distractor generation failed: {last_error}") from last_error

    def generate_resource(self, row: dict[str, Any]) -> dict[str, Any]:
        correct = self.correct_reading(row)
        wrong = self.generate_wrong_readings(row, correct)
        readings = list(wrong)
        readings.insert(random.randrange(4), correct)
        answers = [
            {"key": chr(ord("A") + index), "reading": reading}
            for index, reading in enumerate(readings)
        ]
        examples = [
            {"ja": row.get(f"example{index}_ja"), "vi": row.get(f"example{index}_vi")}
            for index in range(1, 7)
            if str(row.get(f"example{index}_ja") or "").strip()
        ]
        return {
            "requiredVocabulary": row["required_vocabulary"],
            "kanji": row.get("kanji"),
            "onYomi": row.get("on_yomi"),
            "kunYomi": row.get("kun_yomi"),
            "meaningVi": row.get("meaning_vi"),
            "examples": examples,
            "choices": answers,
            "correctAnswer": correct,
            "correctOption": next(item["key"] for item in answers if item["reading"] == correct),
        }

    def save_resource(self, resource_id: int, data: dict[str, Any]) -> None:
        with self.database.cursor() as cursor:
            cursor.execute(f"""UPDATE {self.schema_sql}.game_resources
              SET resource_data = %s::jsonb, last_error = NULL, updated_at = NOW()
              WHERE game_type = %s AND resource_table = %s AND resource_id = %s""",
              (json.dumps(data, ensure_ascii=False), GAME_TYPE, RESOURCE_TABLE, resource_id))
        self.database.commit()

    def save_error(self, resource_id: int, error: Exception) -> None:
        with self.database.cursor() as cursor:
            cursor.execute(f"""UPDATE {self.schema_sql}.game_resources
              SET last_error = %s, updated_at = NOW()
              WHERE game_type = %s AND resource_table = %s AND resource_id = %s""",
              (str(error)[:4000], GAME_TYPE, RESOURCE_TABLE, resource_id))
        self.database.commit()

    def run(self) -> int:
        rows = self.source_rows()
        self.logger.info("Found %s missing or stale Kanji Rush resources.", len(rows))
        generated = failed = 0
        for index, row in enumerate(rows, 1):
            resource_id = int(row["resource_id"])
            vocabulary = row["required_vocabulary"]
            self.logger.info("Processing %s/%s: %s", index, len(rows), vocabulary)
            try:
                self.save_resource(resource_id, self.generate_resource(row))
                generated += 1
            except Exception as error:
                self.database.rollback()
                failed += 1
                self.save_error(resource_id, error)
                self.logger.exception("Failed RequiredVocabulary=%s", vocabulary)
        self.logger.info("Finished: %s generated, %s failed.", generated, failed)
        print(json.dumps({"success": failed == 0, "generated": generated, "failed": failed}))
        return int(failed > 0)

    def close(self) -> None:
        self.database.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate missing Japanese Lab game resources.")
    parser.add_argument("--config", help="app-tools config JSON.")
    parser.add_argument("--limit", type=int, help="Process at most this many resources.")
    parser.add_argument("--setup-only", action="store_true", help="Create table and exit without AI calls.")
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be positive.")
    job: GameResourceJob | None = None
    try:
        config = load_config(args.config)
        job = GameResourceJob(config, limit=args.limit)
        if args.setup_only:
            print(json.dumps({"success": True, "table": f"{job.schema}.game_resources"}))
            return 0
        return job.run()
    except Exception as error:
        print(json.dumps({"success": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1
    finally:
        if job is not None:
            job.close()


if __name__ == "__main__":
    raise SystemExit(main())
