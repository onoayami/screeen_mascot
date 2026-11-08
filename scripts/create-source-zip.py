#!/usr/bin/env python3
"""Create a deterministic UTF-8 source ZIP and verify its entry metadata."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import stat
import subprocess
import tempfile
import unicodedata
import zipfile
from pathlib import Path, PurePosixPath


EXCLUDED_DIRECTORIES = {".git", "dist", "node_modules"}
EXCLUDED_FILES = {".DS_Store"}
FIXED_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
FALLBACK_ROOT_FILES = {
    ".gitattributes",
    ".gitignore",
    "LICENSE",
    "README.md",
    "START_HERE.txt",
    "THIRD_PARTY_NOTICES.md",
    "A3-Mac実機検証.command",
    "A3-Windows解凍確認.bat",
    "A3-Windows解凍確認.ps1",
    "build-mac.command",
    "index.html",
    "main.js",
    "package-lock.json",
    "package.json",
    "preload-mascot.js",
    "preload.js",
    "renderer.js",
    "settings.css",
    "settings.html",
    "settings.js",
    "setup.command",
    "start.command",
    "style.css",
}
FALLBACK_ROOT_DIRECTORIES = {"build", "docs", "scripts", "shared", "tests"}


def portable_relative(root: Path, file_path: Path) -> str:
    value = file_path.relative_to(root).as_posix()
    if value != unicodedata.normalize("NFC", value):
        raise ValueError(f"ファイル名をUnicode NFCへ統一してください：{value}")
    return value


def validate_prefix(value: str) -> str:
    normalized = unicodedata.normalize("NFC", value.strip()).strip("/")
    path_value = PurePosixPath(normalized)
    if not normalized or path_value.is_absolute() or any(part in {"", ".", ".."} for part in path_value.parts):
        raise ValueError(f"ZIPの先頭フォルダ名が正しくありません：{value}")
    return path_value.as_posix()


def normalize_character_reference(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} が空です。")
    portable = value.strip().replace("\\", "/")
    normalized = PurePosixPath(portable)
    if normalized.is_absolute() or any(part in {"", ".", ".."} for part in normalized.parts):
        raise ValueError(f"{field} が素材フォルダの外を指しています：{value}")
    if normalized.as_posix() != portable:
        raise ValueError(f"{field} を正規化した相対パスにしてください：{value}")
    return f"characters/default/{portable}"


def referenced_character_files(root: Path) -> set[str]:
    config_relative = "characters/default/config.json"
    config_path = root / config_relative
    if not config_path.is_file():
        return set()
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"配布用config.jsonを読めません：{error}") from error
    actions = config.get("actions") if isinstance(config, dict) else None
    if not isinstance(actions, list) or not actions:
        raise ValueError("配布用config.jsonのactionsを1件以上にしてください。")
    included = {config_relative}
    for index, action in enumerate(actions):
        if not isinstance(action, dict):
            raise ValueError(f"actions[{index}] はオブジェクトにしてください。")
        included.add(normalize_character_reference(action.get("file"), f"actions[{index}].file"))
        effect = action.get("effect")
        if effect is not None:
            if not isinstance(effect, dict):
                raise ValueError(f"actions[{index}].effect はオブジェクトにしてください。")
            included.add(
                normalize_character_reference(effect.get("file"), f"actions[{index}].effect.file"),
            )
    return included


def git_tracked_files(root: Path) -> set[str] | None:
    if not (root / ".git").exists():
        return None
    result = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=root,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        message = result.stderr.decode("utf-8", errors="replace").strip()
        raise ValueError(f"Git追跡ファイルを確認できません：{message}")
    try:
        tracked = {value for value in result.stdout.decode("utf-8").split("\0") if value}
    except UnicodeDecodeError as error:
        raise ValueError(f"Git追跡ファイル名がUTF-8ではありません：{error}") from error

    untracked_result = subprocess.run(
        ["git", "ls-files", "--others", "--exclude-standard", "-z"],
        cwd=root,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if untracked_result.returncode != 0:
        message = untracked_result.stderr.decode("utf-8", errors="replace").strip()
        raise ValueError(f"Git未追跡ファイルを確認できません：{message}")
    try:
        untracked = [
            value for value in untracked_result.stdout.decode("utf-8").split("\0") if value
        ]
    except UnicodeDecodeError as error:
        raise ValueError(f"Git未追跡ファイル名がUTF-8ではありません：{error}") from error
    if untracked:
        listing = "\n".join(f"- {value}" for value in untracked)
        raise ValueError(
            "未追跡ファイルがあるため、ソースZIPを中止しました。"
            "必要なファイルをGitで追跡するか、不要なファイルを除外してください：\n"
            f"{listing}"
        )
    return tracked


def fallback_source_files(root: Path) -> set[str]:
    included: set[str] = set()
    for candidate in root.rglob("*"):
        if not candidate.is_file() and not candidate.is_symlink():
            continue
        relative_path = portable_relative(root, candidate)
        parts = PurePosixPath(relative_path).parts
        if relative_path in FALLBACK_ROOT_FILES or (parts and parts[0] in FALLBACK_ROOT_DIRECTORIES):
            included.add(relative_path)
    return included


def source_allowlist(root: Path) -> set[str]:
    character_files = referenced_character_files(root)
    tracked = git_tracked_files(root)
    if tracked is None:
        included = fallback_source_files(root)
    else:
        included = {
            relative_path
            for relative_path in tracked
            if not relative_path.startswith("characters/default/")
        }
    included.update(character_files)
    return included


def collect_files(root: Path, output: Path) -> list[tuple[str, Path]]:
    rows: list[tuple[str, Path]] = []
    output_resolved = output.resolve()
    for relative_path in sorted(source_allowlist(root)):
        relative_parts = PurePosixPath(relative_path).parts
        if any(part in EXCLUDED_DIRECTORIES for part in relative_parts):
            continue
        candidate = root.joinpath(*relative_parts)
        if candidate.name in EXCLUDED_FILES:
            continue
        if not candidate.exists() and not candidate.is_symlink():
            raise ValueError(f"ZIP対象ファイルが見つかりません：{relative_path}")
        if candidate.is_symlink():
            raise ValueError(f"シンボリックリンクはZIPへ含めません：{relative_path}")
        if not candidate.is_file():
            raise ValueError(f"通常ファイル以外はZIPへ含めません：{relative_path}")
        if candidate.resolve() == output_resolved:
            continue
        rows.append((portable_relative(root, candidate), candidate))
    return sorted(rows, key=lambda row: row[0])


def entry_mode(relative_path: str) -> int:
    permissions = 0o755 if relative_path.endswith(".command") else 0o644
    return stat.S_IFREG | permissions


def write_archive(root: Path, output: Path, prefix: str) -> tuple[int, str]:
    files = collect_files(root, output)
    if not files:
        raise ValueError("ZIPへ含めるファイルがありません。")
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{output.stem}.",
        suffix=".tmp",
        dir=output.parent,
    )
    os.close(descriptor)
    temporary = Path(temporary_name)
    expected_names: list[str] = []
    try:
        with zipfile.ZipFile(
            temporary,
            mode="w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=9,
            strict_timestamps=True,
        ) as archive:
            for relative_path, file_path in files:
                entry_name = f"{prefix}/{relative_path}"
                expected_names.append(entry_name)
                info = zipfile.ZipInfo(entry_name, FIXED_TIMESTAMP)
                info.create_system = 3
                info.external_attr = entry_mode(relative_path) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, file_path.read_bytes(), compresslevel=9)

        with zipfile.ZipFile(temporary) as archive:
            entries = archive.infolist()
            names = [entry.filename for entry in entries]
            if names != expected_names:
                raise ValueError("ZIP内のファイル順またはファイル名が作成前一覧と一致しません。")
            for entry in entries:
                if "\ufffd" in entry.filename:
                    raise ValueError(f"ZIP名に置換文字U+FFFDがあります：{entry.filename}")
                if any(ord(character) > 127 for character in entry.filename) and not entry.flag_bits & 0x800:
                    raise ValueError(f"日本語ZIP名にUTF-8フラグがありません：{entry.filename}")

        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)

    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    return len(files), digest


def default_values(root: Path) -> tuple[Path, str]:
    package = json.loads((root / "package.json").read_text(encoding="utf-8"))
    prefix = f"{package['name']}-v{package['version']}"
    return root / "dist" / f"{prefix}-source.zip", prefix


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--prefix")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    root = args.root.resolve()
    if not root.is_dir():
        raise SystemExit(f"プロジェクトフォルダが見つかりません：{root}")
    try:
        default_output = None
        default_prefix = None
        if args.output is None or args.prefix is None:
            default_output, default_prefix = default_values(root)
        output = (args.output or default_output).resolve()
        prefix = validate_prefix(args.prefix or default_prefix)
        file_count, digest = write_archive(root, output, prefix)
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        raise SystemExit(f"ソースZIPを作成できませんでした：{error}") from error
    print(f"ソースZIP: {output}")
    print(f"ファイル数: {file_count}")
    print(f"SHA-256: {digest}")


if __name__ == "__main__":
    main()
