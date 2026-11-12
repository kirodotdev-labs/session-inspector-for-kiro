"""Offline tests for the download alias mapping. No GitHub access required."""

from pathlib import Path
import tempfile
import unittest

from publish_download_aliases import ALIASES, collect_aliases


class DownloadAliasesTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        for pattern in ALIASES:
            (self.directory / pattern.replace("*", "9.8.7")).write_bytes(b"installer")

    def test_maps_all_platforms_without_changing_originals(self):
        result = collect_aliases(self.directory)
        self.assertEqual(len(result), 6)
        self.assertEqual({alias for _, alias in result}, set(ALIASES.values()))
        for source, _ in result:
            self.assertEqual(source.read_bytes(), b"installer")

    def test_rejects_missing_platform(self):
        next(self.directory.glob("*.dmg")).unlink()
        with self.assertRaises(ValueError):
            collect_aliases(self.directory)

    def test_rejects_ambiguous_assets(self):
        (self.directory / "Kiro.Sessions.Inspector_9.8.8_aarch64.dmg").write_bytes(b"duplicate")
        with self.assertRaises(ValueError):
            collect_aliases(self.directory)

    def test_ignores_existing_aliases_and_signatures(self):
        for alias in ALIASES.values():
            (self.directory / alias).write_bytes(b"old alias")
        (self.directory / "Kiro.Sessions.Inspector_9.8.7_amd64.AppImage.sig").write_bytes(b"signature")
        self.assertEqual(len(collect_aliases(self.directory)), 6)

    def test_rejects_empty_installer(self):
        next(self.directory.glob("*.deb")).write_bytes(b"")
        with self.assertRaises(ValueError):
            collect_aliases(self.directory)

    def test_rejects_symlink(self):
        source = next(self.directory.glob("*.deb"))
        source.unlink()
        target = self.directory / "target"
        target.write_bytes(b"installer")
        source.symlink_to(target)
        with self.assertRaises(ValueError):
            collect_aliases(self.directory)


if __name__ == "__main__":
    unittest.main()
