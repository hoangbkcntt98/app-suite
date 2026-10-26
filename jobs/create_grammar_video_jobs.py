#!/usr/bin/env python3
"""Generate one JLPT N1 grammar video using shared app-tools helpers."""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
APP_TOOLS_ROOT = REPOSITORY_ROOT / "app-tools"
if str(APP_TOOLS_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_TOOLS_ROOT))

from python.ai import call_api, text_to_audio, text_to_image
from python.config import load_config
from python.database import DatabasePool
from python.logger import get_logger
from python.video import concatenate_videos

CONTENT_PROMPT = """Generate JLPT N1 learning content for Japanese grammar pattern 「{pattern}」.
Return only valid JSON with these required fields:
meaning_ja, meaning_vi, structure, usage_note, nuance, examples, signal, after_clause.
examples must contain exactly 3 objects with example_ja, note, and example_vi.
Use Japanese for meaning_ja, usage_note, nuance, signal, after_clause, example_ja, and note.
Use Vietnamese for meaning_vi and example_vi. Make examples natural and JLPT N1 level."""


def _setting(config: dict[str, Any], section: str, key: str, default: Any = None) -> Any:
    value = config.get(section, {})
    return value.get(key, default) if isinstance(value, dict) else default


def _safe_name(value: str, fallback: str) -> str:
    name = value.lstrip("〜～")
    name = re.sub(r'[/／\s\t\.,!?:;"\']+', "_", name)
    name = re.sub(r"_+", "_", name).strip("_")
    return name or fallback


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


class GrammarVideoJob:
    def __init__(self, config: dict[str, Any]):
        self.config = config
        self.logger = get_logger("grammar-video-job", config)
        self.database = DatabasePool.create(config)
        self.data_dir = Path(_setting(config, "paths", "dataDir", "data"))
        self.output_dir = Path(_setting(config, "paths", "outputDir", "outputs"))
        self.date_dir = datetime.now().strftime("%Y%m%d")
        self.data_path = self.data_dir / self.date_dir
        self.output_path = self.output_dir / self.date_dir
        self.pattern: dict[str, Any] | None = None
        self.safe_name = ""

    def claim_next_grammar(self) -> dict[str, Any] | None:
        rows = self.database.execute(
            "SELECT * FROM claim_next_grammar(%s)",
            ("openclaw-n1-video-pipeline",),
        )
        if not rows:
            self.logger.info("No remaining unprocessed grammar patterns.")
            return None
        row = rows[0]
        if not isinstance(row, dict):
            raise RuntimeError("Database claim returned an invalid row.")
        return row

    def select_pattern(self, pattern_id: int | None) -> None:
        if pattern_id is None:
            self.pattern = self.claim_next_grammar()
            if self.pattern is None:
                raise RuntimeError("No unprocessed grammar pattern available.")
        else:
            if pattern_id <= 0:
                raise ValueError("--pattern-id must be positive.")
            rows = self.database.select(
                "grammar_patterns",
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
            self.pattern = {
                "pattern_id": int(row.get("id", pattern_id)),
                "pattern": pattern_name.strip(),
            }
        assert self.pattern is not None
        self.safe_name = _safe_name(str(self.pattern["pattern"]), str(self.pattern["pattern_id"]))
        self.data_path.mkdir(parents=True, exist_ok=True)
        self.output_path.mkdir(parents=True, exist_ok=True)
        self.logger.info("Selected grammar %s (ID: %s)", self.pattern["pattern"], self.pattern["pattern_id"])

    def generate_content(self) -> dict[str, Any]:
        assert self.pattern is not None
        ai = self.config.get("ai", {})
        chat = ai.get("chat", {}) if isinstance(ai, dict) else {}
        endpoint = str(chat.get("endpoint", "")).strip()
        if not endpoint:
            raise ValueError("Configure ai.chat.endpoint in app-tools config.")
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
        content = _parse_content(response)
        (self.data_path / f"{self.safe_name}_content.json").write_text(
            json.dumps(content, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return content

    def save_learning_content(self, content: dict[str, Any]) -> None:
        assert self.pattern is not None
        self.database.execute(
            """SELECT save_generated_learning_content(
                p_pattern_id := %s, p_meaning_ja := %s, p_meaning_vi := %s,
                p_structure := %s, p_usage_note := %s, p_nuance := %s,
                p_examples := %s::jsonb, p_generated_by := %s
            )""",
            (
                self.pattern["pattern_id"], content["meaning_ja"], content["meaning_vi"],
                content["structure"], content["usage_note"], content["nuance"],
                json.dumps(content["examples"], ensure_ascii=False), "create-grammar-video-job",
            ),
        )

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
        caption = (
            f"{self.pattern['pattern']}\n{content['meaning_ja']}\n\n"
            f"例文：{examples[0]['example_ja']}\n\n#JLPTN1 #日本語学習 #N1文法"
        )
        (self.data_path / f"{self.safe_name}_reel_caption.txt").write_text(caption, encoding="utf-8")
        return paths

    def generate_assets(
        self,
        content: dict[str, Any],
        scripts: list[Path],
    ) -> tuple[list[Path], list[Path]]:
        assert self.pattern is not None
        image_paths: list[Path] = []
        audio_paths: list[Path] = []
        for index in range(1, 4):
            image_path = self.data_path / f"{self.safe_name}_image_part{index}.png"
            prompt = (
                f"Create a clean educational illustration for a Japanese JLPT N1 grammar lesson. "
                f"Grammar: {self.pattern['pattern']}. Meaning: {content['meaning_ja']}. "
                f"Part {index} of 3. No text, vertical composition, calm Japanese classroom mood."
            )
            image_path.write_bytes(text_to_image(prompt, config=self.config))
            image_paths.append(image_path)

            extension = str(_setting(self.config, "jobs", "audio_extension", "mp3")).lstrip(".")
            audio_path = self.data_path / f"{self.safe_name}_script_part{index}.{extension}"
            audio_path.write_bytes(text_to_audio(scripts[index - 1].read_text(encoding="utf-8"), config=self.config))
            audio_paths.append(audio_path)
        return image_paths, audio_paths

    def render_video(self, image_paths: list[Path], audio_paths: list[Path]) -> Path:
        assert self.pattern is not None
        ffmpeg = str(_setting(self.config, "jobs", "ffmpeg_bin", "ffmpeg"))
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
            subprocess.run(command, check=True, capture_output=True, text=True)
            segments.append(segment)
        output = self.output_path / f"{self.safe_name}_video.mp4"
        try:
            concatenate_videos(segments, output)
        except subprocess.CalledProcessError:
            concatenate_videos(segments, output, reencode=True)
        for segment in segments:
            segment.unlink(missing_ok=True)
        return output

    def update_status(self, status: str) -> None:
        assert self.pattern is not None
        self.database.execute(
            "UPDATE grammar_patterns SET processing_status = %s, updated_at = NOW() WHERE id = %s",
            (status, self.pattern["pattern_id"]),
        )

    def fail(self, error: str) -> None:
        if self.pattern is None:
            return
        self.database.execute(
            "SELECT fail_grammar_pattern(p_pattern_id := %s, p_error_message := %s)",
            (self.pattern["pattern_id"], error[:4000]),
        )

    def run(self, pattern_id: int | None = None) -> Path:
        try:
            self.select_pattern(pattern_id)
            content = self.generate_content()
            self.save_learning_content(content)
            self.update_status("examples_generated")
            scripts = self.write_scripts(content)
            self.update_status("script_generated")
            image_paths, audio_paths = self.generate_assets(content, scripts)
            self.update_status("assets_generated")
            output = self.render_video(image_paths, audio_paths)
            if not output.is_file() or output.stat().st_size == 0:
                raise RuntimeError("Generated video is missing or empty.")
            self.update_status("video_generated")
            self.logger.info("Video ready: %s", output)
            return output
        except Exception as error:
            self.logger.exception("Grammar video job failed.")
            self.fail(str(error))
            raise
        finally:
            self.database.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Create one JLPT N1 grammar lesson video.")
    parser.add_argument("--config", help="app-tools JSON config; defaults to COMMON_TOOLS_CONFIG/config.json")
    parser.add_argument("--pattern-id", type=int, help="Process one grammar ID instead of claiming next")
    args = parser.parse_args()
    try:
        config = load_config(args.config)
        output = GrammarVideoJob(config).run(args.pattern_id)
        print(json.dumps({"success": True, "video_path": str(output)}, ensure_ascii=False))
        return 0
    except Exception as error:
        print(json.dumps({"success": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
