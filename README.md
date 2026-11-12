# Kiro Sessions Inspector

[![Desktop builds](https://github.com/kirodotdev-labs/session-inspector-for-kiro/actions/workflows/release.yml/badge.svg)](https://github.com/kirodotdev-labs/session-inspector-for-kiro/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/kirodotdev-labs/session-inspector-for-kiro?label=latest%20release)](https://github.com/kirodotdev-labs/session-inspector-for-kiro/releases/latest)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)

Explore your [Kiro](https://kiro.dev/) IDE and CLI history in one desktop app.
Review conversations, inspect tool calls, search past sessions, and understand
your usage across projects—without setting up a server.

[Download](https://github.com/kirodotdev-labs/session-inspector-for-kiro/releases)
· [Build from source](#build-from-source)
· [Contribute](CONTRIBUTING.md)
· [Report an issue](https://github.com/kirodotdev-labs/session-inspector-for-kiro/issues)

![Kiro Sessions Inspector tour: browse three workspaces, inspect CLI v2, IDE and unified sessions, expand a tool call, search history, and configure an analysis.](docs/media/kiro-sessions-inspector-demo.gif)

*A 33-second tour using sanitized excerpts from five sessions across three
workspaces. [Static preview](docs/media/kiro-sessions-inspector-demo-poster.png)
· [Playback page](docs/demo.html)
(open `docs/demo.html` in a local clone for playback controls).*

## What you can do

- **Browse your history.** Find IDE, CLI, and unified sessions by workspace.
- **Inspect a conversation.** Expand tool calls to see inputs, outputs, and
  execution status, and explore subagent sessions when available.
- **Search across sessions.** Use full-text search with source filters and
  highlighted matches. Indexed content remains searchable even after the
  original session files are removed.
- **Understand your usage.** View activity, credit usage, and model breakdowns
  across all projects or a single workspace.
- **Generate an analysis.** Optionally use Kiro CLI to analyze the last day,
  week, or month and save an HTML report.
- **Pick up where you left off.** Copy a session ID or a CLI resume command
  from the session view.

## Get started

### Download the latest release

[![Download for macOS Apple Silicon](https://img.shields.io/badge/macOS-Apple%20Silicon-222222?logo=apple&logoColor=white)](https://github.com/kirodotdev-labs/session-inspector-for-kiro/releases/latest/download/Kiro-Sessions-Inspector-macOS-Apple-Silicon.dmg)
[![Download for macOS Intel](https://img.shields.io/badge/macOS-Intel-555555?logo=apple&logoColor=white)](https://github.com/kirodotdev-labs/session-inspector-for-kiro/releases/latest/download/Kiro-Sessions-Inspector-macOS-Intel.dmg)
[![Download for Windows x64](https://img.shields.io/badge/Windows-x64-0078D4)](https://github.com/kirodotdev-labs/session-inspector-for-kiro/releases/latest/download/Kiro-Sessions-Inspector-Windows-x64.exe)
[![Download for Linux x64](https://img.shields.io/badge/Linux-x64%20AppImage-FCC624?logo=linux&logoColor=black)](https://github.com/kirodotdev-labs/session-inspector-for-kiro/releases/latest/download/Kiro-Sessions-Inspector-Linux-x64.AppImage)

These links always download the latest stable release. Linux packages are also
available as [`.deb`](https://github.com/kirodotdev-labs/session-inspector-for-kiro/releases/latest/download/Kiro-Sessions-Inspector-Linux-x64.deb)
and [`.rpm`](https://github.com/kirodotdev-labs/session-inspector-for-kiro/releases/latest/download/Kiro-Sessions-Inspector-Linux-x64.rpm).
See [release notes and all assets](https://github.com/kirodotdev-labs/session-inspector-for-kiro/releases/latest)
for details. The **Desktop builds** badge reports the combined release workflow
for all four build targets.

1. Download the installer for your operating system above.
2. Install and launch **Kiro Sessions Inspector** on the machine where you use
   Kiro. The app discovers session files in their standard locations; no import
   or separate server is required.
3. Choose a workspace or session in the sidebar, or open **Search** to find a
   previous conversation.

**Not seeing older sessions?** Enable **Settings → Show non-unified sessions**
to include legacy IDE and CLI formats. Refresh the sidebar after creating new
sessions; use **Reindex** in Search to update search results.

**Installer warnings:** macOS builds are ad-hoc signed, not notarized; Windows
installers are unsigned. Your operating system may warn or block installation.
Review the release notes and your organization's security policy before
proceeding, and only install assets from a source you trust.

### Optional: analyze your sessions

Analysis requires an installed, authenticated Kiro CLI. If the app cannot find
`kiro-cli`, set its full path in **Settings → kiro-cli → Binary path**. Then
open **Analyze**, choose a time window and tone, and run the analysis. Reports
are saved locally and can be opened in your browser.

Unlike browsing and search, analysis uses Kiro's model service and may consume
Kiro credits. See [Privacy and local data](#privacy-and-local-data) before
running it on sensitive sessions.

### Updates

The app checks for updates on launch. You can also use
**Settings → Check for updates**, then **Install & restart** when an update is
available. Update checks and downloads require network access to GitHub.

## Privacy and local data

- **Browsing, dashboards, and search run locally.** The app reads Kiro's
  session files through its Rust backend and maintains a local SQLite search
  index. These features do not require sending session content to a service.
- **The search index retains content.** Deleting original session files does
  not automatically remove their indexed content. Treat the app's local data
  as sensitive, just like the original sessions.
- **Analysis is opt-in and is not local-only.** It invokes Kiro CLI with
  summarized usage and tool-outcome data. The analyst can request additional
  session information, including your original prompts, through local MCP
  tools; that information becomes part of its model context. Raw tool inputs
  and outputs are excluded from those analysis tools.
- **Reports are stored locally.** Review reports, screenshots, and session
  excerpts for sensitive information before sharing them.

### Supported session formats

| Format | Default location |
| --- | --- |
| IDE | Kiro's `User/globalStorage/kiro.kiroagent/` directory |
| Legacy CLI (v2) | `~/.kiro/sessions/cli/` |
| Unified IDE + CLI (v3) | `~/.kiro/sessions/` |

For IDE sessions, the app looks under `~/Library/Application Support/Kiro/` on
macOS, `%APPDATA%\Kiro\` on Windows, and the system config directory (normally
`~/.config/Kiro/`) on Linux. The Windows IDE location is not yet verified.
Available session details depend on what Kiro recorded; on-disk format changes
may require an app update.

## Build from source

### Prerequisites

- Node.js **22.12+** and [pnpm](https://pnpm.io/installation) **10**.
- The stable [Rust toolchain](https://www.rust-lang.org/tools/install).
- The [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/)
  for your operating system, including Xcode Command Line Tools on macOS,
  Microsoft C++ Build Tools and WebView2 on Windows, or the required WebKitGTK
  and system libraries on Linux.
- Existing Kiro sessions to inspect; Kiro CLI is needed only for analysis and
  resuming CLI sessions.

```bash
git clone https://github.com/kirodotdev-labs/session-inspector-for-kiro.git
cd session-inspector-for-kiro
pnpm install --frozen-lockfile
pnpm tauri dev
```

Use `pnpm tauri dev` to run the complete desktop app. `pnpm dev` starts only
the frontend development server, without native session access.

### Development commands

| Command | Purpose |
| --- | --- |
| `pnpm tauri dev` | Run the desktop app with live frontend updates |
| `pnpm lint` | Run ESLint |
| `pnpm build` | Type-check and build the frontend |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Run Rust tests |
| `pnpm tauri build` | Build the desktop app and native bundles |

Native bundles are written to `src-tauri/target/release/bundle/` for a default
build. Build on each target operating system to produce its installers.

### Project structure

```text
src/                    React + TypeScript interface
  components/           Dashboards, session viewer, search, analysis, settings
  lib/                  Native API bindings and shared UI state
src-tauri/src/
  sessions/             Session discovery and format parsers
  search/               SQLite full-text search index
  analysis/             Kiro CLI analysis and report storage
  mcp/                  Tools used by the analyst
```

## Documentation and contributing

- [Contributing guidelines](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md)
- [Supported session formats](#supported-session-formats)
- [Demo playback page](docs/demo.html) (open locally with the `docs/media/` assets)
- [Release and updater guide](docs/RELEASING.md) for maintainers

For bugs and feature requests, use the
[issue tracker](https://github.com/kirodotdev-labs/session-inspector-for-kiro/issues).
Include your app version, operating system, and steps to reproduce. Redact
private prompts, paths, credentials, and tool output from any attachments.

**Security issues:** follow the
[private reporting instructions](CONTRIBUTING.md#security-issue-notifications)
rather than opening a public issue.

## License

Licensed under [Apache-2.0](LICENSE). See [NOTICE](NOTICE) and
[THIRD-PARTY-LICENSES](THIRD-PARTY-LICENSES) for additional notices and dependency
attributions.
