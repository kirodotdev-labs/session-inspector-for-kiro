# Kiro Sessions Inspector

Inspect the sessions and tool executions recorded by the Kiro IDE and CLI
directly from your local Application Support folder. It's a **desktop (Tauri)**
app — the React UI wrapped in a native shell for macOS, Windows, and Linux. No
server required; session data is read directly from disk via Rust commands.

It reads the three on-disk session formats Kiro uses: IDE workspace sessions
(`globalStorage/kiro.kiroagent/workspace-sessions`), CLI v2 sessions
(`~/.kiro/sessions/cli`) and unified v3 sessions (`~/.kiro/sessions`).

### Layout

```
src/
  App.tsx               # top-level routing
  main.tsx              # React entry
  components/
    Dashboard.tsx       # aggregate stats, charts, breakdowns
    SessionView.tsx     # message thread with expandable tool calls
    Sidebar.tsx         # workspace + session list
    SearchView.tsx      # full-text session search
src-tauri/
  src/sessions/         # reads ~/Library/Application Support/Kiro + ~/.kiro
  src/search/           # persistent SQLite FTS5 search index
```

### Data sources

The Rust backend reads directly from:

```
~/Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent/
  workspace-sessions/           # per-workspace session metadata (sessions.json, <sessionId>.json)
  <sha256[:32](workspace)>/...  # per-execution JSON files with tool calls and usage
~/.kiro/sessions/               # CLI (v2) and unified (v3) sessions
```

No credentials are sent off-machine; everything stays on local disk.

---

## Desktop app (Tauri)

The Rust side (`src-tauri/src/sessions/`) reads the session JSON files and
hashed workspace directories directly.

### Requirements

- Node 20+ and [pnpm](https://pnpm.io/) (via `corepack enable` or `brew install pnpm`)
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- Platform-specific Tauri prerequisites — see the
  [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)
  (Xcode Command Line Tools on macOS, WebView2 on Windows — usually
  preinstalled on Windows 11 — and `libwebkit2gtk`/`libappindicator3`/etc.
  on Linux)

### Dev run

```bash
pnpm install
pnpm tauri dev
```

### Build an installer for your current OS

```bash
pnpm tauri build
```

Produces a native installer under `src-tauri/target/release/bundle/`:
`.app`/`.dmg` on macOS, `.msi`/`.exe` (NSIS) on Windows, `.deb`/`.AppImage`/
`.rpm` on Linux. Tauri only cross-bundles for the OS it's running on, so
building all three platforms' installers requires running `tauri build` on
each OS (see the CI workflow below for how this repo automates that).

### Linting

```bash
pnpm lint
```

ESLint is configured in `eslint.config.js` with TypeScript + React hooks
rules. Prettier is not currently wired up.


### Cross-platform releases via CI

[`.github/workflows/release.yml`](.github/workflows/release.yml) builds
macOS (arm64 + x64), Windows (x64), and Linux (x64) installers in parallel
using [`tauri-apps/tauri-action`](https://github.com/tauri-apps/tauri-action)
and attaches them as draft assets on a GitHub Release. Trigger it by pushing
a tag or running it manually:

```bash
git tag app-v0.2.0
git push --tags
```

or from the Actions tab, run "Release desktop app" via `workflow_dispatch`.
None of the builds are code-signed/notarized (macOS is ad-hoc signed,
Windows/Linux are unsigned) — see the generated release notes for the
first-run workaround on each OS.

### Auto-update

The desktop app ships with the Tauri updater (`tauri-plugin-updater`). It
checks for a new version on launch and exposes a manual **Check for updates**
button in the **Settings** tab; an available update also shows a top banner
with **Install & restart**.

For updates to actually flow, the release process must publish **signed**
artifacts plus a `latest.json` manifest to a location the app can reach
**without authentication**.

**1. Signing keys** (already generated once; keep the private key secret):

```bash
pnpm tauri signer generate -w ~/.kiro-updater.key
```

- The **public key** goes in `src-tauri/tauri.conf.json` under
  `plugins.updater.pubkey` (committed).
- The **private key** + its password are provided to release builds via the
  env vars `TAURI_SIGNING_PRIVATE_KEY` (the key file's contents) and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Store these as CI secrets —
  **never commit them**.

### Publishing via GitHub Releases (recommended)

This is the least effort: [`tauri-apps/tauri-action`](https://github.com/tauri-apps/tauri-action)
(already used in [`.github/workflows/release.yml`](.github/workflows/release.yml))
builds signed artifacts, **generates `latest.json`, and uploads it to the
Release automatically** — no manual manifest or S3 upload.

1. **Endpoint** — set `plugins.updater.endpoints[0]` in
   `src-tauri/tauri.conf.json` to GitHub's stable "latest release" URL:

   ```
   https://github.com/<OWNER>/<REPO>/releases/latest/download/latest.json
   ```

2. **Signing secrets** — add repository **Actions secrets**
   `TAURI_SIGNING_PRIVATE_KEY` (the key file's contents) and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty if the key has no password). The
   workflow passes them to the `tauri-action` step (see its `env:` block).

3. **Publish, not draft** — the `/releases/latest/download/` URL only resolves
   to a **published, non-prerelease** release. Keep `releaseDraft: false` (or
   remember to publish the draft), otherwise the updater won't find it.

4. **Public repo** — the in-app updater fetches `latest.json` and the artifacts
   unauthenticated, so the repository/release assets must be public. (Your
   primary remote is an internal GitLab; push the `app-v*` tag to a public
   GitHub remote to trigger this workflow.)

Nothing else changes: the plugins, `createUpdaterArtifacts`, the in-app
banner/Settings UI, and the keypair stay as-is.

### Publishing to a custom endpoint / S3 (alternative)

If you host the manifest yourself instead of GitHub, build signed artifacts
with `bundle.createUpdaterArtifacts: true` (already set) and the signing env
vars present; `pnpm tauri build` then emits an updater artifact and a detached
signature per platform:

- macOS: `*.app.tar.gz` + `*.app.tar.gz.sig`
- Linux: `*.AppImage` + `*.AppImage.sig`
- Windows: `*-setup.exe` + `*-setup.exe.sig` (NSIS)

Upload each artifact to your bucket/CDN and write a `latest.json` referencing
their public URLs and the `.sig` contents:

```json
{
  "version": "0.2.0",
  "notes": "What changed…",
  "pub_date": "2026-07-07T00:00:00Z",
  "platforms": {
    "darwin-aarch64": { "signature": "<contents of the .app.tar.gz.sig>", "url": "https://downloads.example.com/kiro/0.2.0/KiroSessionsInspector-aarch64.app.tar.gz" },
    "darwin-x86_64":  { "signature": "…", "url": "https://…/KiroSessionsInspector-x86_64.app.tar.gz" },
    "linux-x86_64":   { "signature": "…", "url": "https://…/kiro_0.2.0_amd64.AppImage" },
    "windows-x86_64": { "signature": "…", "url": "https://…/kiro_0.2.0_x64-setup.exe" }
  }
}
```

Point `plugins.updater.endpoints[0]` at that `latest.json` URL. Updates are
verified by the minisign signature, so the transport needn't be trusted — but
it **must** be reachable by the app without a login (a public bucket/CloudFront
works; an authenticated internal GitLab does not).

---

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This project is licensed under the [Apache-2.0](LICENSE) License.

Third-party software and content included in the app is attributed in
[THIRD-PARTY-LICENSES](THIRD-PARTY-LICENSES). Regenerate it with
`pnpm third-party-licenses` (requires `cargo install cargo-about --locked`)
whenever dependencies change and before each release.
