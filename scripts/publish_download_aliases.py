#!/usr/bin/env python3
"""Publish stable installer filenames for README latest-release downloads.

Uses gh's existing authentication. Original assets and updater manifests are
never edited; only the six aliases listed below may be uploaded or replaced.
"""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


ALIASES = {
    "Kiro.Sessions.Inspector_*_aarch64.dmg": "Kiro-Sessions-Inspector-macOS-Apple-Silicon.dmg",
    "Kiro.Sessions.Inspector_*_x64.dmg": "Kiro-Sessions-Inspector-macOS-Intel.dmg",
    "Kiro.Sessions.Inspector_*_x64-setup.exe": "Kiro-Sessions-Inspector-Windows-x64.exe",
    "Kiro.Sessions.Inspector_*_amd64.AppImage": "Kiro-Sessions-Inspector-Linux-x64.AppImage",
    "Kiro.Sessions.Inspector_*_amd64.deb": "Kiro-Sessions-Inspector-Linux-x64.deb",
    "Kiro.Sessions.Inspector-*-1.x86_64.rpm": "Kiro-Sessions-Inspector-Linux-x64.rpm",
}


def collect_aliases(directory: Path) -> list[tuple[Path, str]]:
    """Require exactly one original installer for every supported target."""
    result = []
    for pattern, alias in ALIASES.items():
        matches = list(directory.glob(pattern))
        if len(matches) != 1:
            raise ValueError(f"Expected one asset matching {pattern!r}; found {len(matches)}")
        source = matches[0]
        if source.is_symlink() or not source.is_file() or source.stat().st_size == 0:
            raise ValueError(f"Installer must be a nonempty regular file: {source.name}")
        result.append((source, alias))
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY"))
    parser.add_argument("--tag", help="Defaults to app-v<version> in tauri.conf.json")
    args = parser.parse_args()
    if not args.repo or args.repo.startswith("-") or len(args.repo.split("/")) != 2:
        parser.error("--repo must be an owner/repository name")
    config = Path(__file__).resolve().parents[1] / "src-tauri/tauri.conf.json"
    tag = args.tag or f"app-v{json.loads(config.read_text())['version']}"
    if not tag.startswith("app-v"):
        parser.error("--tag must start with app-v")

    with tempfile.TemporaryDirectory(prefix="kiro-download-aliases-") as temporary:
        directory = Path(temporary)
        command = ["gh", "release", "download", tag, "--repo", args.repo, "--dir", str(directory)]
        for pattern in ALIASES:
            command.extend(["--pattern", pattern])
        subprocess.run(command, check=True, timeout=600)
        originals = collect_aliases(directory)  # Validate all targets before any upload.
        output = directory / "aliases"
        output.mkdir()
        for source, alias in originals:
            shutil.copyfile(source, output / alias)
            print(f"{source.name} -> {alias}", flush=True)
        subprocess.run(
            ["gh", "release", "upload", tag, "--repo", args.repo, "--clobber",
             *[str(output / alias) for _, alias in originals]],
            check=True, timeout=600,
        )


if __name__ == "__main__":
    main()
