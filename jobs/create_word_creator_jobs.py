#!/usr/bin/env python3
"""Generate WordCreator Japanese-reading quiz videos."""
from __future__ import annotations

import argparse
import html
import json
import os
import random
import re
import shutil
import subprocess
import sys
import time
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "jobs" / "app-tools"
JOB_ID = "create_word_creator_jobs"
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


def _quoted_identifier(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_$-]*", value):
        raise ValueError(f"Invalid PostgreSQL schema name: {value!r}")
    return f'"{value}"'


def _url_settings(value: str) -> dict[str, Any]:
    parsed = urlparse(value)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise ValueError("Database URL must use postgres:// or postgresql://.")
    settings: dict[str, Any] = {
        "host": parsed.hostname,
        "port": parsed.port or 5432,
        "dbname": parsed.path.lstrip("/"),
        "user": unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
    }
    if "sslmode=" in parsed.query:
        settings["sslmode"] = parsed.query.split("sslmode=", 1)[1].split("&", 1)[0]
    return settings


def _db_options(settings: dict[str, Any]) -> dict[str, Any]:
    keys = ("host", "port", "dbname", "user", "password", "sslmode", "options")
    return {key: settings[key] for key in keys if settings.get(key) is not None}


def _safe_name(value: str) -> str:
    name = unicodedata.normalize("NFKC", value)
    name = re.sub(r"[^\w.-]+", "-", name, flags=re.UNICODE).strip("-")
    return (name or "word")[:150]


def _resolve_path(value: str | Path) -> Path:
    path = Path(value).expanduser()
    return path if path.is_absolute() else ROOT / path


class WordCreatorJob:
    def __init__(self, config: dict[str, Any], args: argparse.Namespace):
        self.args = args
        self.config = get_effective_job_config(config, JOB_ID)
        self.logger = get_logger("word-creator-job", self.config)

        main_db = dict(self.config.get("database", {}))
        if os.environ.get("DATABASE_URL", "").strip():
            main_db.update(_url_settings(os.environ["DATABASE_URL"].strip()))
        if not main_db:
            raise ValueError("Configure database in app-tools config or set DATABASE_URL.")
        database_url = os.environ.get("DATABASE_URL", "").strip()
        schema_from_url = parse_qs(urlparse(database_url).query).get("schema", [None])[0]
        self.schema = schema_from_url or str(
            get_job_setting(config, JOB_ID, "database", "schema", "public")
        )
        self.schema_sql = _quoted_identifier(self.schema)
        self.database = psycopg.connect(**_db_options(main_db), row_factory=dict_row)

        anki_db = dict(self.config.get("anki_database", {}))
        if os.environ.get("VIDEO_ANKI_DATABASE_URL", "").strip():
            anki_db.update(_url_settings(os.environ["VIDEO_ANKI_DATABASE_URL"].strip()))
        if not anki_db:
            anki_db = dict(main_db)
            anki_db["dbname"] = "anki"
        self.anki_database = psycopg.connect(**_db_options(anki_db), row_factory=dict_row)

        output_value = os.environ.get(
            "VIDEO_OUTPUT_DIR",
            str(get_job_setting(config, JOB_ID, "paths", "outputDir", "jobs/outputs")),
        )
        self.output_root = _resolve_path(output_value)
        data_value = os.environ.get(
            "VIDEO_DATA_DIR",
            str(get_job_setting(config, JOB_ID, "paths", "dataDir", "/mnt/openclaw-data/openclaw")),
        )
        self.data_root = _resolve_path(data_value)
        word_output = os.environ.get(
            "VIDEO_WORD_CREATOR_OUTPUT_DIR",
            str(get_job_setting(config, JOB_ID, "paths", "wordCreatorOutputDir", self.data_root / "word-creator")),
        )
        self.word_output = _resolve_path(word_output)
        template_value = get_job_setting(
            config, JOB_ID, "paths", "templatePath", "jobs/assets/template.html",
        )
        renderer_value = get_job_setting(
            config, JOB_ID, "paths", "rendererPath", "jobs/assets/html-to-image.js",
        )
        audio_value = get_job_setting(
            config, JOB_ID, "paths", "audioPath", "jobs/assets/audio.wav",
        )
        self.template_path = _resolve_path(template_value)
        self.template_dir = self.template_path.parent
        self.renderer = _resolve_path(renderer_value)
        self.audio_path = _resolve_path(audio_value)
        self.template = self.template_path.read_text(encoding="utf-8")
        if not self.audio_path.is_file():
            raise FileNotFoundError(f"WordCreator audio file not found: {self.audio_path}")
        self.node = str(get_job_setting(config, JOB_ID, "job_config", "node_bin", "node"))

        ai = self.config.get("ai", {})
        self.chat = ai.get("chat", {}) if isinstance(ai, dict) else {}
        self.base_url = str(self.chat.get("base_url", "")).strip().rstrip("/")
        self.endpoint = str(self.chat.get("endpoint", "/chat/completions")).strip()
        self.model = str(self.chat.get("model", "")).strip()
        self.api_key = str(self.chat.get("api_key", "")).strip()
        if not self.api_key and self.chat.get("api_key_env"):
            self.api_key = os.environ.get(str(self.chat["api_key_env"]), "").strip()
        self.timeout = float(self.chat.get("timeout_seconds", 120))
        self.temperature = float(self.chat.get("temperature", 0.7))
        self.max_tokens = int(self.chat.get("max_tokens", 1000))
        self.auth_header = str(self.chat.get("api_key_header", "Authorization"))
        self.auth_scheme = str(self.chat.get("auth_scheme", "Bearer")).strip()
        if not all((self.base_url, self.model, self.api_key)):
            raise ValueError("Configure ai.chat.base_url, model, and api_key (or api_key_env).")
        self.duration = args.duration
        self.fps = args.fps
        self.auto_fps = not args.fixed_fps
        self.ensure_schema()

    def ensure_schema(self) -> None:
        with self.database.cursor() as cursor:
            cursor.execute(f"""CREATE TABLE IF NOT EXISTS {self.schema_sql}.word_creator_questions (
              id BIGSERIAL PRIMARY KEY, anki_note_id BIGINT, source TEXT NOT NULL,
              required_vocabulary TEXT NOT NULL, answer_a TEXT NOT NULL, answer_b TEXT NOT NULL,
              answer_c TEXT NOT NULL, answer_d TEXT NOT NULL,
              correct_index SMALLINT NOT NULL CHECK (correct_index BETWEEN 0 AND 3),
              correct_answer TEXT NOT NULL, template_path TEXT NOT NULL, video_path TEXT,
              duration_seconds NUMERIC, fps SMALLINT NOT NULL DEFAULT 25,
              status TEXT, last_error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (source, required_vocabulary)
            )""")
            cursor.execute(f"""ALTER TABLE {self.schema_sql}.word_creator_questions
              ADD COLUMN IF NOT EXISTS video_path TEXT,
              ADD COLUMN IF NOT EXISTS duration_seconds NUMERIC,
              ADD COLUMN IF NOT EXISTS fps SMALLINT NOT NULL DEFAULT 25,
              ADD COLUMN IF NOT EXISTS status TEXT,
              ADD COLUMN IF NOT EXISTS last_error TEXT""")
            cursor.execute(f"""CREATE TABLE IF NOT EXISTS {self.schema_sql}.video_creator_videos (
              relative_path TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '',
              caption TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )""")
            cursor.execute(f"""ALTER TABLE {self.schema_sql}.video_creator_videos
              ADD COLUMN IF NOT EXISTS facebook_video_id TEXT,
              ADD COLUMN IF NOT EXISTS scheduled_publish_at TIMESTAMPTZ,
              ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
              ADD COLUMN IF NOT EXISTS youtube_video_id TEXT,
              ADD COLUMN IF NOT EXISTS youtube_uploaded_at TIMESTAMPTZ,
              ADD COLUMN IF NOT EXISTS youtube_privacy TEXT""")
        self.database.commit()

    def read_notes(self) -> list[dict[str, Any]]:
        with self.anki_database.cursor() as cursor:
            cursor.execute("""SELECT a.anki_note_id, a."Kanji" AS source,
                     BTRIM(a."RequiredVocabulary") AS vocabulary
              FROM public.anki_kanji a
              WHERE NULLIF(BTRIM(a."RequiredVocabulary"), '') IS NOT NULL
                AND a."Kanji" = ANY(%s::text[])
              ORDER BY a."Kanji" """, (self.args.source,))
            return list(cursor.fetchall())

    def create_answers(self, source: str, vocabulary: str) -> tuple[list[str], int]:
        payload = {
            "model": self.model,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "stream": False,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": "You create Japanese multiple-choice reading questions. Return JSON only."},
                {"role": "user", "content": "\n".join((
                    f"Kanji/source: {source}",
                    f"RequiredVocabulary: {vocabulary}",
                    "Return JSON with answers array of 4 strings and correctIndex as integer 0, 1, 2, or 3.",
                    "One answer must be the correct Japanese reading of RequiredVocabulary, in hiragana or katakana.",
                    "Other answers must be plausible but incorrect readings. No explanations or duplicates.",
                ))},
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
                    headers=headers, json=payload, timeout=self.timeout,
                )
                response.raise_for_status()
                raw = response.json()["choices"][0]["message"]["content"].strip()
                raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.IGNORECASE).strip()
                parsed = json.loads(raw)
                answers = parsed.get("answers")
                index = parsed.get("correctIndex")
                if not isinstance(answers, list) or len(answers) != 4 or any(
                    not isinstance(answer, str) or not answer.strip() for answer in answers
                ):
                    raise ValueError("AI must return exactly four non-empty answers.")
                answers = [answer.strip() for answer in answers]
                if len(set(answers)) != 4:
                    raise ValueError("AI returned duplicate answers.")
                if isinstance(index, bool) or not isinstance(index, int) or not 0 <= index <= 3:
                    raise ValueError("AI returned invalid correctIndex.")
                shuffled_index = random.randrange(4)
                answers[shuffled_index], answers[index] = answers[index], answers[shuffled_index]
                return answers, shuffled_index
            except Exception as error:
                last_error = error
                if attempt == 0:
                    time.sleep(0.5)
        raise RuntimeError(f"LLM answer generation failed: {last_error}") from last_error

    def render_html(self, vocabulary: str, answers: list[str], correct_index: int) -> Path:
        self.word_output.mkdir(parents=True, exist_ok=True)
        html_path = self.word_output / f"{_safe_name(self.args.current_source)}.html"
        values = {"Word": vocabulary, **{
            f"Answer{letter}": answer for letter, answer in zip("ABCD", answers)
        }}
        content = self.template
        for key, value in values.items():
            content = content.replace(f"{{{{{key}}}}}", html.escape(value, quote=True))
        quiz_data = {**values, "correctIndex": correct_index}
        json_literal = json.dumps(values, ensure_ascii=False).replace("<", "\\u003c")
        script = (
            "<script>document.addEventListener('DOMContentLoaded',function(){"
            f"if(typeof window.setQuiz==='function')window.setQuiz({json_literal});"
            f"if(typeof window.quizCorrectIndex==='undefined')window.quizCorrectIndex={correct_index};"
            "});</script>"
        )
        content = re.sub(r"</body>", lambda match: script + match.group(0), content, count=1, flags=re.I)
        html_path.write_text(content, encoding="utf-8")

        references = set(re.findall(r"""(?:src|href)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)""", content, re.I))
        for left, right in references:
            reference = left or right
            if not reference or re.match(r"^(?:data:|https?:|file:|#)", reference, re.I):
                continue
            relative = reference.split("?", 1)[0].split("#", 1)[0]
            target = (html_path.parent / relative).resolve()
            if html_path.parent.resolve() not in target.parents:
                continue
            if Path(relative).name == "spinning-bear.gif":
                mascot = self.data_root / "word-creator/assets/spinning-bear.gif"
                if not mascot.is_file():
                    mascot = self.template_dir / "spinning-bear.gif"
                if not mascot.is_file():
                    raise FileNotFoundError("Missing WordCreator spinning-bear.gif.")
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(mascot, target)
            elif not target.exists():
                source = (self.template_dir / relative).resolve()
                if self.template_dir.resolve() in source.parents and source.is_file():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(source, target)
        return html_path

    def render_video(self, html_path: Path, video_path: Path, quiz: dict[str, Any]) -> int:
        data_path = html_path.with_suffix(".json")
        data_path.write_text(json.dumps(quiz, ensure_ascii=False), encoding="utf-8")
        command = [
            self.node, str(self.renderer), "--html", str(html_path), "--output", str(video_path),
            "--duration", str(self.duration), "--fps", str(self.fps), "--data", str(data_path),
            "--question-audio", str(self.audio_path),
        ]
        if not self.auto_fps:
            command.append("--fixed-fps")
        try:
            result = subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True)
        except subprocess.CalledProcessError as error:
            raise RuntimeError((error.stderr or error.stdout or str(error))[-4000:]) from error
        finally:
            data_path.unlink(missing_ok=True)
        for line in result.stdout.splitlines():
            self.logger.info("%s", line)
            if line.startswith("WORD_CREATOR_RESULT="):
                return int(json.loads(line.split("=", 1)[1])["fps"])
        raise RuntimeError("Renderer did not return actual FPS.")

    def generate_one(self, row: dict[str, Any]) -> str:
        source = str(row["source"]).strip()
        vocabulary = str(row["vocabulary"]).strip()
        self.args.current_source = source
        answers, correct_index = self.create_answers(source, vocabulary)
        html_path = self.render_html(vocabulary, answers, correct_index)
        output_dir = self.output_root / datetime.now().strftime("%Y%m%d") / "word-creator"
        output_dir.mkdir(parents=True, exist_ok=True)
        video_path = output_dir / f"{int(time.time() * 1000)}-{_safe_name(source)}_word.mp4"
        quiz = {
            "Word": vocabulary, "AnswerA": answers[0], "AnswerB": answers[1],
            "AnswerC": answers[2], "AnswerD": answers[3], "correctIndex": correct_index,
        }
        actual_fps = self.render_video(html_path, video_path, quiz)
        relative_path = video_path.relative_to(self.output_root).as_posix()
        with self.database.cursor() as cursor:
            cursor.execute(f"""INSERT INTO {self.schema_sql}.video_creator_videos
              (relative_path, title, caption, updated_at) VALUES (%s, %s, %s, NOW())
              ON CONFLICT (relative_path) DO UPDATE SET
                title = EXCLUDED.title, caption = EXCLUDED.caption, updated_at = NOW()""",
              (relative_path, vocabulary, f"{vocabulary} #kanji #jlpt #n1 #japanese #日本語 #漢字"))
            cursor.execute(f"""INSERT INTO {self.schema_sql}.word_creator_questions
              (anki_note_id, source, required_vocabulary, answer_a, answer_b, answer_c, answer_d,
               correct_index, correct_answer, template_path, video_path, duration_seconds, fps,
               status, last_error, updated_at)
              VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'video_generated',NULL,NOW())
              ON CONFLICT (source, required_vocabulary) DO UPDATE SET
                anki_note_id=EXCLUDED.anki_note_id, answer_a=EXCLUDED.answer_a,
                answer_b=EXCLUDED.answer_b, answer_c=EXCLUDED.answer_c, answer_d=EXCLUDED.answer_d,
                correct_index=EXCLUDED.correct_index, correct_answer=EXCLUDED.correct_answer,
                template_path=EXCLUDED.template_path, video_path=EXCLUDED.video_path,
                duration_seconds=EXCLUDED.duration_seconds, fps=EXCLUDED.fps,
                status='video_generated', last_error=NULL, updated_at=NOW()""",
              (row["anki_note_id"], source, vocabulary, *answers, correct_index,
               answers[correct_index], str(html_path), relative_path, self.duration, actual_fps))
        self.database.commit()
        return relative_path

    def run(self) -> int:
        with self.anki_database.cursor() as cursor:
            cursor.execute("""SELECT a.anki_note_id, a."Kanji" AS source,
                     BTRIM(a."RequiredVocabulary") AS vocabulary
              FROM public.anki_kanji a
              WHERE NULLIF(BTRIM(a."RequiredVocabulary"), '') IS NOT NULL
                AND a."Kanji" = ANY(%s::text[])
              ORDER BY a."Kanji" """, (self.args.source,))
            rows = list(cursor.fetchall())
        generated = errors = 0
        for number, row in enumerate(rows, 1):
            self.logger.info("Processing %s/%s: %s / %s", number, len(rows), row["source"], row["vocabulary"])
            try:
                path = self.generate_one(row)
                generated += 1
                self.logger.info("Saved video: %s", path)
            except Exception:
                self.database.rollback()
                errors += 1
                self.logger.exception("Failed source=%s vocabulary=%s", row["source"], row["vocabulary"])
        self.logger.info("Finished: %s/%s generated, %s failed.", generated, len(rows), errors)
        return int(errors > 0)

    def close(self) -> None:
        self.anki_database.close()
        self.database.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate WordCreator quiz videos.")
    parser.add_argument("--config", default=None, help="app-tools config JSON.")
    parser.add_argument("--source", action="append", required=True, help="Kanji source; repeat for multiple.")
    parser.add_argument("--duration", type=float, default=10)
    parser.add_argument("--fps", type=int, default=25)
    parser.add_argument("--fixed-fps", action="store_true")
    args = parser.parse_args()
    args.source = list(dict.fromkeys(value.strip() for value in args.source if value.strip()))
    if not args.source or len(args.source) > 100:
        parser.error("Pass 1 to 100 non-empty --source values.")
    if not 0 < args.duration <= 300:
        parser.error("--duration must be greater than 0 and at most 300.")
    if not 1 <= args.fps <= 60:
        parser.error("--fps must be from 1 to 60.")
    return args


def main() -> int:
    args = parse_args()
    config = load_config(args.config)
    job = WordCreatorJob(config, args)
    try:
        return job.run()
    finally:
        job.close()


if __name__ == "__main__":
    raise SystemExit(main())
