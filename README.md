# Kiro Sessions Inspector

Inspect the sessions and tool executions recorded by the Kiro IDE directly
from your local Application Support folder. The app ships in two forms from
this repo:

- **Desktop (Tauri)** — the React UI wrapped in a native shell for macOS,
  Windows, and Linux. No server required; session data is read directly
  from disk via Rust commands.
- **Web** — the same React + Vite UI with a small Express backend that reads
  the session JSON files. Runs in a browser.

Both read the same on-disk format documented in
[`KIRO_SESSION_FORMAT.md`](KIRO_SESSION_FORMAT.md).

---

## Web version (React + Express)

### Requirements

- Node 20+
- [pnpm](https://pnpm.io/) (installed via `corepack enable` or `brew install pnpm`)

### Install and run

```bash
pnpm install
pnpm start
```

`pnpm start` uses [`concurrently`](https://www.npmjs.com/package/concurrently)
to launch two processes:

| Script        | What it does                                              | Port |
| ------------- | --------------------------------------------------------- | ---- |
| `pnpm dev`    | Vite dev server for the React UI with HMR                 | 5173 |
| `pnpm server` | Express API (`server/index.ts`) that streams session JSON | 3000 |

Open <http://localhost:5173> once both are running.

### Layout

```
src/
  App.tsx               # top-level routing
  main.tsx              # React entry
  components/
    Dashboard.tsx       # aggregate stats, charts, breakdowns
    SessionView.tsx     # message thread with expandable tool calls
    Sidebar.tsx         # workspace + session list
server/
  index.ts              # Express API reading ~/Library/Application Support/Kiro
```

### Data sources

The Express backend reads directly from:

```
~/Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent/
  workspace-sessions/           # per-workspace session metadata (sessions.json, <sessionId>.json)
  <sha256[:32](workspace)>/...  # per-execution JSON files with tool calls and usage
```

No credentials are sent off-machine; everything stays on local disk.

### Build a production bundle

```bash
pnpm build        # emits ./dist
pnpm preview      # serves ./dist on http://localhost:4173
```

In production you still need `pnpm server` running (or the Express code
ported behind whatever reverse proxy you prefer) so the UI can fetch
session data.

### Linting

```bash
pnpm lint
```

ESLint is configured in `eslint.config.js` with TypeScript + React hooks
rules. Prettier is not currently wired up.

---

## Desktop version (Tauri)

A fully offline native app — no Express backend. The Rust side
(`src-tauri/src/sessions/`) reads the same JSON files and hashed workspace
directories directly, mirroring `server/index.ts`.

### Requirements

- Everything the web version needs (Node 20+, pnpm)
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

---

## License

[MIT-0](LICENSE) (MIT No Attribution) — use it however you like.
