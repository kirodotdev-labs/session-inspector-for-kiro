# Release and updater guide

This guide is for maintainers publishing Kiro Sessions Inspector. For local
development and builds, see the [README](../README.md#build-from-source).

## Release workflow

The [Release desktop app workflow](../.github/workflows/release.yml) builds
macOS (Apple Silicon and Intel), Windows (x64), and Linux (x64) bundles with
[`tauri-apps/tauri-action`](https://github.com/tauri-apps/tauri-action).
It uploads the installers, updater artifacts, and `latest.json` to a
**published, non-prerelease** GitHub Release—not a draft.

Before triggering a release:

1. Update the version in `package.json`, `src-tauri/Cargo.toml`, and
   `src-tauri/tauri.conf.json`, and keep the corresponding lockfiles in sync.
2. Run the lint, frontend build, and Rust tests listed in the README.
3. Regenerate dependency attributions with `pnpm third-party-licenses`.
   This requires `cargo install cargo-about --locked`. Review and commit any
   changes to `THIRD-PARTY-LICENSES`.
4. Confirm the repository's Actions permissions allow release uploads and
   the updater signing secrets described below are configured.

Push a version tag to the public GitHub repository. For example, if that
remote is named `github`:

```bash
git tag app-v0.2.0
git push github app-v0.2.0
```

Use the version being released, rather than reusing an existing tag. You can
also run **Release desktop app** from the Actions tab. The workflow derives
the release version from the Tauri configuration; its current manual `version`
input is not wired into the build.

After all platform jobs finish, verify the published release contains the
expected installers, signatures, and `latest.json`. Test installation and
an update from the previous version on each supported platform.

### Stable download links

Once all four builds succeed, the workflow runs
[`scripts/publish_download_aliases.py`](../scripts/publish_download_aliases.py)
to publish six version-independent aliases for the original installers:

- `Kiro-Sessions-Inspector-macOS-Apple-Silicon.dmg`
- `Kiro-Sessions-Inspector-macOS-Intel.dmg`
- `Kiro-Sessions-Inspector-Windows-x64.exe`
- `Kiro-Sessions-Inspector-Linux-x64.AppImage`
- `Kiro-Sessions-Inspector-Linux-x64.deb`
- `Kiro-Sessions-Inspector-Linux-x64.rpm`

The README links to these names under `/releases/latest/download/`. The script
requires all six original installers before uploading any aliases. Originals,
signatures, and `latest.json` stay unchanged; the aliases are for manual
downloads, not the in-app updater.

To add or repair aliases for an existing release, authenticate GitHub CLI with
release-write access and run:

```bash
python3 scripts/publish_download_aliases.py \
  --repo kirodotdev-labs/session-inspector-for-kiro --tag app-v0.2.0
```

Run its offline checks with `python3 scripts/test_publish_download_aliases.py`.

## Updater signing

The app uses `tauri-plugin-updater` and enables `bundle.createUpdaterArtifacts`
in [`tauri.conf.json`](../src-tauri/tauri.conf.json). Its public key verifies
downloaded updates. **Updater signing is separate from operating-system code
signing:** the current macOS builds are ad-hoc signed and not notarized, and
Windows installers are unsigned.

The updater keypair is already configured. Keep the private key outside the
repository. Release builds receive it through repository Actions secrets:

| Secret | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of the private key file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Key password, or empty for an unencrypted key |

For an initial setup in a separate fork, generate a new keypair with:

```bash
pnpm tauri signer generate -w ~/.kiro-updater.key
```

Set `plugins.updater.pubkey` to the new public key. Do not replace an existing
production key without planning how installed clients will trust future
updates. Never commit a private key or its password.

## GitHub update endpoint

The configured endpoint is:

```text
https://github.com/kirodotdev-labs/session-inspector-for-kiro/releases/latest/download/latest.json
```

The manifest and update artifacts must be accessible without authentication.
GitHub's `latest` download URL requires a published, non-prerelease release.
The workflow generates and uploads the manifest automatically; do not maintain
a separate copy by hand.

For a fork, change the endpoint to the fork's public release URL and configure
its own signing keys before distributing builds.

## Custom update hosting

To host updates somewhere other than GitHub, build with the signing environment
variables above and `bundle.createUpdaterArtifacts: true`. Upload the updater
artifacts and their detached signatures to your HTTPS host:

- macOS: `*.app.tar.gz` and `*.app.tar.gz.sig`
- Linux: `*.AppImage` and `*.AppImage.sig`
- Windows (NSIS): `*-setup.exe` and `*-setup.exe.sig`

Publish a Tauri-compatible `latest.json` containing the version, release notes,
publication date, and a `platforms` map. Use the keys `darwin-aarch64`,
`darwin-x86_64`, `linux-x86_64`, and `windows-x86_64`; each entry needs an HTTPS
`url` and a `signature` containing the corresponding `.sig` file's contents.
Set `plugins.updater.endpoints` to the manifest's HTTPS URL.

Keep both the manifest and artifacts publicly reachable, retain signature
verification, and test the complete update path before publishing. See the
[Tauri updater documentation](https://v2.tauri.app/plugin/updater/) for the
manifest schema and platform-specific behavior.
