"""
Locate well-known per-user folders without any OS-specific dependencies.

Linux follows the XDG user-dirs specification, so a localized or relocated
Downloads folder (for example ~/Téléchargements) is respected.
"""

import os
import re
import shutil
from pathlib import Path


def _xdg_download_from_user_dirs(home: Path) -> Path | None:
    config_home = os.environ.get("XDG_CONFIG_HOME")

    config_dir = (
        Path(config_home)
        if config_home and os.path.isabs(config_home)
        else home / ".config"
    )

    user_dirs_file = config_dir / "user-dirs.dirs"

    try:
        text = user_dirs_file.read_text(encoding="utf-8")
    except OSError:
        return None

    match = re.search(
        r'^\s*XDG_DOWNLOAD_DIR\s*=\s*"?([^"\n]+)"?\s*$',
        text,
        re.MULTILINE,
    )

    if not match:
        return None

    raw = match.group(1).strip().replace("$HOME", str(home))

    path = Path(raw)

    if not path.is_absolute():
        return None

    # A value equal to $HOME means "no download folder configured".
    if path == home:
        return None

    return path


def get_downloads_dir() -> Path:
    """Return the user's Downloads folder (created if it is missing)."""

    home = Path.home()

    candidates: list[Path] = []

    env_value = os.environ.get("XDG_DOWNLOAD_DIR")

    if env_value and os.path.isabs(env_value):
        candidates.append(Path(env_value))

    from_file = _xdg_download_from_user_dirs(home)

    if from_file is not None:
        candidates.append(from_file)

    candidates.append(home / "Downloads")

    for candidate in candidates:
        try:
            candidate.mkdir(parents=True, exist_ok=True)
        except OSError:
            continue

        if candidate.is_dir() and os.access(candidate, os.W_OK):
            return candidate

    return home


def export_file_to_downloads(source: Path, filename: str) -> Path:
    """
    Copy ``source`` into the Downloads folder as ``filename``.
    The copy is atomic, so a half-written file is never visible.
    """

    destination_dir = get_downloads_dir()
    destination = destination_dir / filename

    temporary = destination_dir / f".{filename}.part"

    try:
        shutil.copyfile(source, temporary)
        os.replace(temporary, destination)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass

    return destination
