# Third-Party Dependencies & Licenses

Kiro Sessions Inspector bundles third-party code from two ecosystems: the
**npm** frontend (React + Vite + Tauri JS bindings) and the **Cargo** desktop
backend (Rust + Tauri). This document lists every dependency and its declared
license, split into direct **Runtime**, direct **Dev**, and **Transitive**
dependencies for each ecosystem.

- Generated: 2026-07-09
- The project itself is licensed under [MIT-0](LICENSE).
- Source of truth: `package.json` / `pnpm-lock.yaml` (npm, via `pnpm licenses list`)
  and `src-tauri/Cargo.toml` / `Cargo.lock` (Cargo, via `cargo metadata`).
- License strings are the values declared by each package (SPDX expressions);
  `OR` means you may choose any one of the listed licenses.

## Summary

| Ecosystem | Direct runtime | Direct dev | Transitive | Total |
| --- | --- | --- | --- | --- |
| npm | 9 | 13 | 150 | 172 |
| Cargo | 13 | 1 (build) | 440 | 454 |

### npm license breakdown (all 172 packages)

| License | Count |
| --- | --- |
| MIT | 130 |
| Apache-2.0 | 14 |
| ISC | 11 |
| BSD-2-Clause | 6 |
| Apache-2.0 OR MIT | 3 |
| MIT OR Apache-2.0 | 2 |
| BSD-3-Clause | 2 |
| MPL-2.0 | 2 |
| CC-BY-4.0 | 1 |
| BlueOak-1.0.0 | 1 |

### Cargo license breakdown (all 454 packages)

| License | Count |
| --- | --- |
| MIT OR Apache-2.0 | 193 |
| MIT | 118 |
| Apache-2.0 OR MIT | 36 |
| MIT/Apache-2.0 | 21 |
| Zlib OR Apache-2.0 OR MIT | 18 |
| Unicode-3.0 | 18 |
| MPL-2.0 | 5 |
| Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | 5 |
| Unlicense OR MIT | 4 |
| BSD-3-Clause | 3 |
| Apache-2.0 | 3 |
| Apache-2.0/MIT | 3 |
| Apache-2.0 OR ISC OR MIT | 3 |
| ISC | 3 |
| BSD-3-Clause OR MIT OR Apache-2.0 | 2 |
| MIT OR Apache-2.0 OR Zlib | 2 |
| Unlicense/MIT | 2 |
| BSD-2-Clause OR Apache-2.0 OR MIT | 2 |
| 0BSD OR MIT OR Apache-2.0 | 1 |
| BSD-3-Clause AND MIT | 1 |
| BSD-3-Clause/MIT | 1 |
| Apache-2.0 AND MIT | 1 |
| CC0-1.0 OR MIT-0 OR Apache-2.0 | 1 |
| Apache-2.0 / MIT | 1 |
| Zlib | 1 |
| MIT OR Zlib OR Apache-2.0 | 1 |
| MIT OR Apache-2.0 OR LGPL-2.1-or-later | 1 |
| Apache-2.0 AND ISC | 1 |
| Apache-2.0 WITH LLVM-exception | 1 |
| (MIT OR Apache-2.0) AND Unicode-3.0 | 1 |
| CDLA-Permissive-2.0 | 1 |

---

## npm — Runtime dependencies (direct)

| Package | Version(s) | License |
| --- | --- | --- |
| `@tailwindcss/vite` | 4.2.4 | MIT |
| `@tauri-apps/api` | 2.11.1 | Apache-2.0 OR MIT |
| `@tauri-apps/plugin-process` | 2.3.1 | MIT OR Apache-2.0 |
| `@tauri-apps/plugin-updater` | 2.10.1 | MIT OR Apache-2.0 |
| `clsx` | 2.1.1 | MIT |
| `lucide-react` | 1.14.0 | ISC |
| `react` | 19.2.6 | MIT |
| `react-dom` | 19.2.6 | MIT |
| `tailwindcss` | 4.2.4 | MIT |

## npm — Dev dependencies (direct)

| Package | Version(s) | License |
| --- | --- | --- |
| `@eslint/js` | 10.0.1 | MIT |
| `@tauri-apps/cli` | 2.11.4 | Apache-2.0 OR MIT |
| `@types/node` | 24.12.3 | MIT |
| `@types/react` | 19.2.14 | MIT |
| `@types/react-dom` | 19.2.3 | MIT |
| `@vitejs/plugin-react` | 6.0.1 | MIT |
| `eslint` | 10.3.0 | MIT |
| `eslint-plugin-react-hooks` | 7.1.1 | MIT |
| `eslint-plugin-react-refresh` | 0.5.2 | MIT |
| `globals` | 17.6.0 | MIT |
| `typescript` | 6.0.3 | Apache-2.0 |
| `typescript-eslint` | 8.59.2 | MIT |
| `vite` | 8.0.11 | MIT |

## npm — Transitive dependencies

| Package | Version(s) | License |
| --- | --- | --- |
| `@babel/code-frame` | 7.29.0 | MIT |
| `@babel/compat-data` | 7.29.3 | MIT |
| `@babel/core` | 7.29.0 | MIT |
| `@babel/generator` | 7.29.1 | MIT |
| `@babel/helper-compilation-targets` | 7.28.6 | MIT |
| `@babel/helper-globals` | 7.28.0 | MIT |
| `@babel/helper-module-imports` | 7.28.6 | MIT |
| `@babel/helper-module-transforms` | 7.28.6 | MIT |
| `@babel/helper-string-parser` | 7.27.1 | MIT |
| `@babel/helper-validator-identifier` | 7.28.5 | MIT |
| `@babel/helper-validator-option` | 7.27.1 | MIT |
| `@babel/helpers` | 7.29.2 | MIT |
| `@babel/parser` | 7.29.3 | MIT |
| `@babel/template` | 7.28.6 | MIT |
| `@babel/traverse` | 7.29.0 | MIT |
| `@babel/types` | 7.29.0 | MIT |
| `@esbuild/darwin-arm64` | 0.27.7 | MIT |
| `@eslint-community/eslint-utils` | 4.9.1 | MIT |
| `@eslint-community/regexpp` | 4.12.2 | MIT |
| `@eslint/config-array` | 0.23.5 | Apache-2.0 |
| `@eslint/config-helpers` | 0.5.5 | Apache-2.0 |
| `@eslint/core` | 1.2.1 | Apache-2.0 |
| `@eslint/object-schema` | 3.0.5 | Apache-2.0 |
| `@eslint/plugin-kit` | 0.7.1 | Apache-2.0 |
| `@humanfs/core` | 0.19.2 | Apache-2.0 |
| `@humanfs/node` | 0.16.8 | Apache-2.0 |
| `@humanfs/types` | 0.15.0 | Apache-2.0 |
| `@humanwhocodes/module-importer` | 1.0.1 | Apache-2.0 |
| `@humanwhocodes/retry` | 0.4.3 | Apache-2.0 |
| `@jridgewell/gen-mapping` | 0.3.13 | MIT |
| `@jridgewell/remapping` | 2.3.5 | MIT |
| `@jridgewell/resolve-uri` | 3.1.2 | MIT |
| `@jridgewell/sourcemap-codec` | 1.5.5 | MIT |
| `@jridgewell/trace-mapping` | 0.3.31 | MIT |
| `@oxc-project/types` | 0.128.0 | MIT |
| `@rolldown/binding-darwin-arm64` | 1.0.0-rc.18 | MIT |
| `@rolldown/pluginutils` | 1.0.0-rc.7, 1.0.0-rc.18 | MIT |
| `@tailwindcss/node` | 4.2.4 | MIT |
| `@tailwindcss/oxide` | 4.2.4 | MIT |
| `@tailwindcss/oxide-darwin-arm64` | 4.2.4 | MIT |
| `@tauri-apps/cli-darwin-arm64` | 2.11.4 | Apache-2.0 OR MIT |
| `@types/esrecurse` | 4.3.1 | MIT |
| `@types/estree` | 1.0.9 | MIT |
| `@types/json-schema` | 7.0.15 | MIT |
| `@typescript-eslint/eslint-plugin` | 8.59.2 | MIT |
| `@typescript-eslint/parser` | 8.59.2 | MIT |
| `@typescript-eslint/project-service` | 8.59.2 | MIT |
| `@typescript-eslint/scope-manager` | 8.59.2 | MIT |
| `@typescript-eslint/tsconfig-utils` | 8.59.2 | MIT |
| `@typescript-eslint/type-utils` | 8.59.2 | MIT |
| `@typescript-eslint/types` | 8.59.2 | MIT |
| `@typescript-eslint/typescript-estree` | 8.59.2 | MIT |
| `@typescript-eslint/utils` | 8.59.2 | MIT |
| `@typescript-eslint/visitor-keys` | 8.59.2 | MIT |
| `acorn` | 8.16.0 | MIT |
| `acorn-jsx` | 5.3.2 | MIT |
| `ajv` | 6.15.0 | MIT |
| `balanced-match` | 4.0.4 | MIT |
| `baseline-browser-mapping` | 2.10.27 | Apache-2.0 |
| `brace-expansion` | 5.0.6 | MIT |
| `browserslist` | 4.28.2 | MIT |
| `caniuse-lite` | 1.0.30001792 | CC-BY-4.0 |
| `convert-source-map` | 2.0.0 | MIT |
| `cross-spawn` | 7.0.6 | MIT |
| `csstype` | 3.2.3 | MIT |
| `debug` | 4.4.3 | MIT |
| `deep-is` | 0.1.4 | MIT |
| `detect-libc` | 2.1.2 | Apache-2.0 |
| `electron-to-chromium` | 1.5.352 | ISC |
| `enhanced-resolve` | 5.21.1 | MIT |
| `esbuild` | 0.27.7 | MIT |
| `escalade` | 3.2.0 | MIT |
| `escape-string-regexp` | 4.0.0 | MIT |
| `eslint-scope` | 9.1.2 | BSD-2-Clause |
| `eslint-visitor-keys` | 3.4.3, 5.0.1 | Apache-2.0 |
| `espree` | 11.2.0 | BSD-2-Clause |
| `esquery` | 1.7.0 | BSD-3-Clause |
| `esrecurse` | 4.3.0 | BSD-2-Clause |
| `estraverse` | 5.3.0 | BSD-2-Clause |
| `esutils` | 2.0.3 | BSD-2-Clause |
| `fast-deep-equal` | 3.1.3 | MIT |
| `fast-json-stable-stringify` | 2.1.0 | MIT |
| `fast-levenshtein` | 2.0.6 | MIT |
| `fdir` | 6.5.0 | MIT |
| `file-entry-cache` | 8.0.0 | MIT |
| `find-up` | 5.0.0 | MIT |
| `flat-cache` | 4.0.1 | MIT |
| `flatted` | 3.4.2 | ISC |
| `fsevents` | 2.3.3 | MIT |
| `gensync` | 1.0.0-beta.2 | MIT |
| `get-tsconfig` | 4.14.0 | MIT |
| `glob-parent` | 6.0.2 | ISC |
| `graceful-fs` | 4.2.11 | ISC |
| `hermes-estree` | 0.25.1 | MIT |
| `hermes-parser` | 0.25.1 | MIT |
| `ignore` | 5.3.2, 7.0.5 | MIT |
| `imurmurhash` | 0.1.4 | MIT |
| `is-extglob` | 2.1.1 | MIT |
| `is-glob` | 4.0.3 | MIT |
| `isexe` | 2.0.0 | ISC |
| `jiti` | 2.7.0 | MIT |
| `js-tokens` | 4.0.0 | MIT |
| `jsesc` | 3.1.0 | MIT |
| `json-buffer` | 3.0.1 | MIT |
| `json-schema-traverse` | 0.4.1 | MIT |
| `json-stable-stringify-without-jsonify` | 1.0.1 | MIT |
| `json5` | 2.2.3 | MIT |
| `keyv` | 4.5.4 | MIT |
| `levn` | 0.4.1 | MIT |
| `lightningcss` | 1.32.0 | MPL-2.0 |
| `lightningcss-darwin-arm64` | 1.32.0 | MPL-2.0 |
| `locate-path` | 6.0.0 | MIT |
| `lru-cache` | 5.1.1 | ISC |
| `magic-string` | 0.30.21 | MIT |
| `minimatch` | 10.2.5 | BlueOak-1.0.0 |
| `ms` | 2.1.3 | MIT |
| `nanoid` | 3.3.12 | MIT |
| `natural-compare` | 1.4.0 | MIT |
| `node-releases` | 2.0.38 | MIT |
| `optionator` | 0.9.4 | MIT |
| `p-limit` | 3.1.0 | MIT |
| `p-locate` | 5.0.0 | MIT |
| `path-exists` | 4.0.0 | MIT |
| `path-key` | 3.1.1 | MIT |
| `picocolors` | 1.1.1 | ISC |
| `picomatch` | 4.0.4 | MIT |
| `postcss` | 8.5.14 | MIT |
| `prelude-ls` | 1.2.1 | MIT |
| `punycode` | 2.3.1 | MIT |
| `resolve-pkg-maps` | 1.0.0 | MIT |
| `rolldown` | 1.0.0-rc.18 | MIT |
| `scheduler` | 0.27.0 | MIT |
| `semver` | 6.3.1, 7.7.4 | ISC |
| `shebang-command` | 2.0.0 | MIT |
| `shebang-regex` | 3.0.0 | MIT |
| `source-map-js` | 1.2.1 | BSD-3-Clause |
| `tapable` | 2.3.3 | MIT |
| `tinyglobby` | 0.2.16 | MIT |
| `ts-api-utils` | 2.5.0 | MIT |
| `tsx` | 4.21.0 | MIT |
| `type-check` | 0.4.0 | MIT |
| `undici-types` | 7.16.0 | MIT |
| `update-browserslist-db` | 1.2.3 | MIT |
| `uri-js` | 4.4.1 | BSD-2-Clause |
| `which` | 2.0.2 | ISC |
| `word-wrap` | 1.2.5 | MIT |
| `yallist` | 3.1.1 | ISC |
| `yocto-queue` | 0.1.0 | MIT |
| `zod` | 4.4.3 | MIT |
| `zod-validation-error` | 4.0.2 | MIT |

---

## Cargo — Runtime dependencies (direct, normal)

| Package | Version(s) | License |
| --- | --- | --- |
| `base64` | 0.21.7, 0.22.1 | MIT OR Apache-2.0 |
| `chrono` | 0.4.45 | MIT OR Apache-2.0 |
| `dirs` | 5.0.1, 6.0.0 | MIT OR Apache-2.0 |
| `log` | 0.4.33 | MIT OR Apache-2.0 |
| `once_cell` | 1.21.4 | MIT OR Apache-2.0 |
| `rusqlite` | 0.32.1 | MIT |
| `serde` | 1.0.228 | MIT OR Apache-2.0 |
| `serde_json` | 1.0.150 | MIT OR Apache-2.0 |
| `sha2` | 0.10.9 | MIT OR Apache-2.0 |
| `tauri` | 2.11.5 | Apache-2.0 OR MIT |
| `tauri-plugin-log` | 2.8.0 | Apache-2.0 OR MIT |
| `tauri-plugin-process` | 2.3.1 | Apache-2.0 OR MIT |
| `tauri-plugin-updater` | 2.10.1 | Apache-2.0 OR MIT |

## Cargo — Build dependencies (direct)

| Package | Version(s) | License |
| --- | --- | --- |
| `tauri-build` | 2.6.3 | Apache-2.0 OR MIT |

## Cargo — Transitive dependencies

| Package | Version(s) | License |
| --- | --- | --- |
| `adler2` | 2.0.1 | 0BSD OR MIT OR Apache-2.0 |
| `ahash` | 0.7.8, 0.8.12 | MIT OR Apache-2.0 |
| `aho-corasick` | 1.1.4 | Unlicense OR MIT |
| `alloc-no-stdlib` | 2.0.4 | BSD-3-Clause |
| `alloc-stdlib` | 0.2.4 | BSD-3-Clause |
| `android_log-sys` | 0.3.2 | MIT OR Apache-2.0 |
| `android_logger` | 0.15.1 | MIT OR Apache-2.0 |
| `android_system_properties` | 0.1.5 | MIT/Apache-2.0 |
| `anyhow` | 1.0.103 | MIT OR Apache-2.0 |
| `arbitrary` | 1.4.2 | MIT OR Apache-2.0 |
| `arrayvec` | 0.7.8 | MIT OR Apache-2.0 |
| `atk` | 0.18.2 | MIT |
| `atk-sys` | 0.18.2 | MIT |
| `atomic-waker` | 1.1.2 | Apache-2.0 OR MIT |
| `autocfg` | 1.5.1 | Apache-2.0 OR MIT |
| `bit-set` | 0.8.0 | Apache-2.0 OR MIT |
| `bit-vec` | 0.8.0 | Apache-2.0 OR MIT |
| `bitflags` | 1.3.2, 2.13.0 | MIT OR Apache-2.0 |
| `bitvec` | 1.1.1 | MIT |
| `block-buffer` | 0.10.4 | MIT OR Apache-2.0 |
| `block2` | 0.6.2 | MIT |
| `borsh` | 1.7.0 | MIT OR Apache-2.0 |
| `borsh-derive` | 1.7.0 | Apache-2.0 |
| `brotli` | 8.0.4 | BSD-3-Clause AND MIT |
| `brotli-decompressor` | 5.0.3 | BSD-3-Clause/MIT |
| `bs58` | 0.5.1 | MIT/Apache-2.0 |
| `bumpalo` | 3.20.3 | MIT OR Apache-2.0 |
| `byte-unit` | 5.2.5 | MIT |
| `bytecheck` | 0.6.12 | MIT |
| `bytecheck_derive` | 0.6.12 | MIT |
| `bytemuck` | 1.25.0 | Zlib OR Apache-2.0 OR MIT |
| `byteorder` | 1.5.0 | Unlicense OR MIT |
| `bytes` | 1.12.0 | MIT |
| `cairo-rs` | 0.18.5 | MIT |
| `cairo-sys-rs` | 0.18.2 | MIT |
| `camino` | 1.2.4 | MIT OR Apache-2.0 |
| `cargo-platform` | 0.1.9 | MIT OR Apache-2.0 |
| `cargo_metadata` | 0.19.2 | MIT |
| `cargo_toml` | 0.22.3 | Apache-2.0 OR MIT |
| `cc` | 1.2.65 | MIT OR Apache-2.0 |
| `cesu8` | 1.1.0 | Apache-2.0/MIT |
| `cfb` | 0.7.3 | MIT |
| `cfg-expr` | 0.15.8 | MIT OR Apache-2.0 |
| `cfg-if` | 1.0.4 | MIT OR Apache-2.0 |
| `cfg_aliases` | 0.2.1 | MIT |
| `combine` | 4.6.7 | MIT |
| `cookie` | 0.18.1 | MIT OR Apache-2.0 |
| `core-foundation` | 0.10.1 | MIT OR Apache-2.0 |
| `core-foundation-sys` | 0.8.7 | MIT OR Apache-2.0 |
| `core-graphics` | 0.25.0 | MIT OR Apache-2.0 |
| `core-graphics-types` | 0.2.0 | MIT OR Apache-2.0 |
| `cpufeatures` | 0.2.17 | MIT OR Apache-2.0 |
| `crc32fast` | 1.5.0 | MIT OR Apache-2.0 |
| `crossbeam-channel` | 0.5.15 | MIT OR Apache-2.0 |
| `crossbeam-utils` | 0.8.21 | MIT OR Apache-2.0 |
| `crypto-common` | 0.1.7 | MIT OR Apache-2.0 |
| `cssparser` | 0.36.0 | MPL-2.0 |
| `cssparser-macros` | 0.6.1 | MPL-2.0 |
| `ctor` | 0.8.0 | Apache-2.0 OR MIT |
| `ctor-proc-macro` | 0.0.7 | Apache-2.0 OR MIT |
| `darling` | 0.23.0 | MIT |
| `darling_core` | 0.23.0 | MIT |
| `darling_macro` | 0.23.0 | MIT |
| `dbus` | 0.9.11 | Apache-2.0/MIT |
| `deranged` | 0.5.8 | MIT OR Apache-2.0 |
| `derive_arbitrary` | 1.4.2 | MIT OR Apache-2.0 |
| `derive_more` | 2.1.1 | MIT |
| `derive_more-impl` | 2.1.1 | MIT |
| `digest` | 0.10.7 | MIT OR Apache-2.0 |
| `dirs-sys` | 0.4.1, 0.5.0 | MIT OR Apache-2.0 |
| `dispatch2` | 0.3.1 | Zlib OR Apache-2.0 OR MIT |
| `displaydoc` | 0.2.6 | MIT OR Apache-2.0 |
| `dlopen2` | 0.8.2 | MIT |
| `dlopen2_derive` | 0.4.3 | MIT |
| `dom_query` | 0.27.0 | MIT |
| `dpi` | 0.1.2 | Apache-2.0 AND MIT |
| `dtoa` | 1.0.11 | MIT OR Apache-2.0 |
| `dtoa-short` | 0.3.5 | MPL-2.0 |
| `dtor` | 0.3.0 | Apache-2.0 OR MIT |
| `dtor-proc-macro` | 0.0.6 | Apache-2.0 OR MIT |
| `dunce` | 1.0.5 | CC0-1.0 OR MIT-0 OR Apache-2.0 |
| `dyn-clone` | 1.0.20 | MIT OR Apache-2.0 |
| `embed-resource` | 3.0.11 | MIT |
| `embed_plist` | 1.2.2 | MIT OR Apache-2.0 |
| `env_filter` | 0.1.4 | MIT OR Apache-2.0 |
| `equivalent` | 1.0.2 | Apache-2.0 OR MIT |
| `erased-serde` | 0.4.10 | MIT OR Apache-2.0 |
| `errno` | 0.3.14 | MIT OR Apache-2.0 |
| `fallible-iterator` | 0.3.0 | MIT/Apache-2.0 |
| `fallible-streaming-iterator` | 0.1.9 | MIT/Apache-2.0 |
| `fastrand` | 2.4.1 | Apache-2.0 OR MIT |
| `fdeflate` | 0.3.7 | MIT OR Apache-2.0 |
| `fern` | 0.7.1 | MIT |
| `field-offset` | 0.3.6 | MIT OR Apache-2.0 |
| `filetime` | 0.2.29 | MIT/Apache-2.0 |
| `find-msvc-tools` | 0.1.9 | MIT OR Apache-2.0 |
| `flate2` | 1.1.9 | MIT OR Apache-2.0 |
| `fnv` | 1.0.7 | Apache-2.0 / MIT |
| `foldhash` | 0.2.0 | Zlib |
| `foreign-types` | 0.5.0 | MIT/Apache-2.0 |
| `foreign-types-macros` | 0.2.3 | MIT/Apache-2.0 |
| `foreign-types-shared` | 0.3.1 | MIT/Apache-2.0 |
| `form_urlencoded` | 1.2.2 | MIT OR Apache-2.0 |
| `funty` | 2.0.0 | MIT |
| `futures-channel` | 0.3.32 | MIT OR Apache-2.0 |
| `futures-core` | 0.3.32 | MIT OR Apache-2.0 |
| `futures-executor` | 0.3.32 | MIT OR Apache-2.0 |
| `futures-io` | 0.3.32 | MIT OR Apache-2.0 |
| `futures-macro` | 0.3.32 | MIT OR Apache-2.0 |
| `futures-sink` | 0.3.32 | MIT OR Apache-2.0 |
| `futures-task` | 0.3.32 | MIT OR Apache-2.0 |
| `futures-util` | 0.3.32 | MIT OR Apache-2.0 |
| `gdk` | 0.18.2 | MIT |
| `gdk-pixbuf` | 0.18.5 | MIT |
| `gdk-pixbuf-sys` | 0.18.0 | MIT |
| `gdk-sys` | 0.18.2 | MIT |
| `gdkwayland-sys` | 0.18.2 | MIT |
| `gdkx11` | 0.18.2 | MIT |
| `gdkx11-sys` | 0.18.2 | MIT |
| `generic-array` | 0.14.7 | MIT |
| `getrandom` | 0.2.17, 0.3.4, 0.4.3 | MIT OR Apache-2.0 |
| `gio` | 0.18.4 | MIT |
| `gio-sys` | 0.18.1 | MIT |
| `glib` | 0.18.5 | MIT |
| `glib-macros` | 0.18.5 | MIT |
| `glib-sys` | 0.18.1 | MIT |
| `glob` | 0.3.3 | MIT OR Apache-2.0 |
| `gobject-sys` | 0.18.0 | MIT |
| `gtk` | 0.18.2 | MIT |
| `gtk-sys` | 0.18.2 | MIT |
| `gtk3-macros` | 0.18.2 | MIT |
| `hashbrown` | 0.12.3, 0.14.5, 0.17.1 | MIT OR Apache-2.0 |
| `hashlink` | 0.9.1 | MIT OR Apache-2.0 |
| `heck` | 0.4.1, 0.5.0 | MIT OR Apache-2.0 |
| `hex` | 0.4.3 | MIT OR Apache-2.0 |
| `html5ever` | 0.38.0 | MIT OR Apache-2.0 |
| `http` | 1.4.2 | MIT OR Apache-2.0 |
| `http-body` | 1.0.1 | MIT |
| `http-body-util` | 0.1.3 | MIT |
| `httparse` | 1.10.1 | MIT OR Apache-2.0 |
| `hyper` | 1.10.1 | MIT |
| `hyper-rustls` | 0.27.9 | Apache-2.0 OR ISC OR MIT |
| `hyper-util` | 0.1.20 | MIT |
| `iana-time-zone` | 0.1.65 | MIT OR Apache-2.0 |
| `iana-time-zone-haiku` | 0.1.2 | MIT OR Apache-2.0 |
| `ico` | 0.5.0 | MIT |
| `icu_collections` | 2.2.0 | Unicode-3.0 |
| `icu_locale_core` | 2.2.0 | Unicode-3.0 |
| `icu_normalizer` | 2.2.0 | Unicode-3.0 |
| `icu_normalizer_data` | 2.2.0 | Unicode-3.0 |
| `icu_properties` | 2.2.0 | Unicode-3.0 |
| `icu_properties_data` | 2.2.0 | Unicode-3.0 |
| `icu_provider` | 2.2.0 | Unicode-3.0 |
| `ident_case` | 1.0.1 | MIT/Apache-2.0 |
| `idna` | 1.1.0 | MIT OR Apache-2.0 |
| `idna_adapter` | 1.2.2 | Apache-2.0 OR MIT |
| `indexmap` | 1.9.3, 2.14.0 | Apache-2.0 OR MIT |
| `infer` | 0.19.0 | MIT |
| `ipnet` | 2.12.0 | MIT OR Apache-2.0 |
| `itoa` | 1.0.18 | MIT OR Apache-2.0 |
| `javascriptcore-rs` | 1.1.2 | MIT |
| `javascriptcore-rs-sys` | 1.1.1 | MIT |
| `jni` | 0.21.1, 0.22.4 | MIT OR Apache-2.0 |
| `jni-macros` | 0.22.4 | MIT OR Apache-2.0 |
| `jni-sys` | 0.3.1, 0.4.1 | MIT OR Apache-2.0 |
| `jni-sys-macros` | 0.4.1 | MIT OR Apache-2.0 |
| `js-sys` | 0.3.103 | MIT OR Apache-2.0 |
| `json-patch` | 3.0.1 | MIT/Apache-2.0 |
| `jsonptr` | 0.6.3 | MIT OR Apache-2.0 |
| `keyboard-types` | 0.7.0 | MIT OR Apache-2.0 |
| `libappindicator` | 0.9.0 | Apache-2.0 OR MIT |
| `libappindicator-sys` | 0.9.0 | Apache-2.0 OR MIT |
| `libc` | 0.2.186 | MIT OR Apache-2.0 |
| `libdbus-sys` | 0.2.7 | Apache-2.0/MIT |
| `libloading` | 0.7.4 | ISC |
| `libredox` | 0.1.18 | MIT |
| `libsqlite3-sys` | 0.30.1 | MIT |
| `linux-raw-sys` | 0.12.1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| `litemap` | 0.8.2 | Unicode-3.0 |
| `lock_api` | 0.4.14 | MIT OR Apache-2.0 |
| `markup5ever` | 0.38.0 | MIT OR Apache-2.0 |
| `memchr` | 2.8.2 | Unlicense OR MIT |
| `memoffset` | 0.9.1 | MIT |
| `mime` | 0.3.17 | MIT OR Apache-2.0 |
| `minisign-verify` | 0.2.5 | MIT |
| `miniz_oxide` | 0.8.9 | MIT OR Zlib OR Apache-2.0 |
| `mio` | 1.2.1 | MIT |
| `muda` | 0.19.3 | Apache-2.0 OR MIT |
| `ndk` | 0.9.0 | MIT OR Apache-2.0 |
| `ndk-sys` | 0.6.0+11769913 | MIT OR Apache-2.0 |
| `new_debug_unreachable` | 1.0.6 | MIT |
| `num-conv` | 0.2.2 | MIT OR Apache-2.0 |
| `num-traits` | 0.2.19 | MIT OR Apache-2.0 |
| `num_enum` | 0.7.6 | BSD-3-Clause OR MIT OR Apache-2.0 |
| `num_enum_derive` | 0.7.6 | BSD-3-Clause OR MIT OR Apache-2.0 |
| `num_threads` | 0.1.7 | MIT OR Apache-2.0 |
| `objc2` | 0.6.4 | MIT |
| `objc2-app-kit` | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| `objc2-cloud-kit` | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| `objc2-core-data` | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| `objc2-core-foundation` | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| `objc2-core-graphics` | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| `objc2-core-image` | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| `objc2-core-location` | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| `objc2-core-text` | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| `objc2-encode` | 4.1.0 | MIT |
| `objc2-exception-helper` | 0.1.1 | Zlib OR Apache-2.0 OR MIT |
| `objc2-foundation` | 0.3.2 | MIT |
| `objc2-io-surface` | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| `objc2-osa-kit` | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| `objc2-quartz-core` | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| `objc2-ui-kit` | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| `objc2-user-notifications` | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| `objc2-web-kit` | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| `openssl-probe` | 0.2.1 | MIT OR Apache-2.0 |
| `option-ext` | 0.2.0 | MPL-2.0 |
| `osakit` | 0.3.1 | MIT OR Apache-2.0 |
| `pango` | 0.18.3 | MIT |
| `pango-sys` | 0.18.0 | MIT |
| `parking_lot` | 0.12.5 | MIT OR Apache-2.0 |
| `parking_lot_core` | 0.9.12 | MIT OR Apache-2.0 |
| `percent-encoding` | 2.3.2 | MIT OR Apache-2.0 |
| `phf` | 0.13.1 | MIT |
| `phf_codegen` | 0.13.1 | MIT |
| `phf_generator` | 0.13.1 | MIT |
| `phf_macros` | 0.13.1 | MIT |
| `phf_shared` | 0.13.1 | MIT |
| `pin-project-lite` | 0.2.17 | Apache-2.0 OR MIT |
| `pkg-config` | 0.3.33 | MIT OR Apache-2.0 |
| `plist` | 1.9.0 | MIT |
| `png` | 0.17.16, 0.18.1 | MIT OR Apache-2.0 |
| `potential_utf` | 0.1.5 | Unicode-3.0 |
| `powerfmt` | 0.2.0 | MIT OR Apache-2.0 |
| `ppv-lite86` | 0.2.21 | MIT OR Apache-2.0 |
| `precomputed-hash` | 0.1.1 | MIT |
| `proc-macro-crate` | 1.3.1, 2.0.2, 3.5.0 | MIT OR Apache-2.0 |
| `proc-macro-error` | 1.0.4 | MIT OR Apache-2.0 |
| `proc-macro-error-attr` | 1.0.4 | MIT OR Apache-2.0 |
| `proc-macro2` | 1.0.106 | MIT OR Apache-2.0 |
| `ptr_meta` | 0.1.4 | MIT |
| `ptr_meta_derive` | 0.1.4 | MIT |
| `quick-xml` | 0.39.4 | MIT |
| `quote` | 1.0.46 | MIT OR Apache-2.0 |
| `r-efi` | 5.3.0, 6.0.0 | MIT OR Apache-2.0 OR LGPL-2.1-or-later |
| `radium` | 0.7.0 | MIT |
| `rand` | 0.8.6 | MIT OR Apache-2.0 |
| `rand_chacha` | 0.3.1 | MIT OR Apache-2.0 |
| `rand_core` | 0.6.4 | MIT OR Apache-2.0 |
| `raw-window-handle` | 0.6.2 | MIT OR Apache-2.0 OR Zlib |
| `redox_syscall` | 0.5.18 | MIT |
| `redox_users` | 0.4.6, 0.5.2 | MIT |
| `ref-cast` | 1.0.25 | MIT OR Apache-2.0 |
| `ref-cast-impl` | 1.0.25 | MIT OR Apache-2.0 |
| `regex` | 1.12.4 | MIT OR Apache-2.0 |
| `regex-automata` | 0.4.14 | MIT OR Apache-2.0 |
| `regex-syntax` | 0.8.11 | MIT OR Apache-2.0 |
| `rend` | 0.4.2 | MIT |
| `reqwest` | 0.13.4 | MIT OR Apache-2.0 |
| `ring` | 0.17.14 | Apache-2.0 AND ISC |
| `rkyv` | 0.7.46 | MIT |
| `rkyv_derive` | 0.7.46 | MIT |
| `rust_decimal` | 1.42.1 | MIT |
| `rustc-hash` | 2.1.2 | Apache-2.0 OR MIT |
| `rustc_version` | 0.4.1 | MIT OR Apache-2.0 |
| `rustix` | 1.1.4 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| `rustls` | 0.23.41 | Apache-2.0 OR ISC OR MIT |
| `rustls-native-certs` | 0.8.4 | Apache-2.0 OR ISC OR MIT |
| `rustls-pki-types` | 1.15.0 | MIT OR Apache-2.0 |
| `rustls-platform-verifier` | 0.7.0 | MIT OR Apache-2.0 |
| `rustls-platform-verifier-android` | 0.1.1 | MIT OR Apache-2.0 |
| `rustls-webpki` | 0.103.13 | ISC |
| `rustversion` | 1.0.22 | MIT OR Apache-2.0 |
| `same-file` | 1.0.6 | Unlicense/MIT |
| `schannel` | 0.1.29 | MIT |
| `schemars` | 0.8.22, 0.9.0, 1.2.1 | MIT |
| `schemars_derive` | 0.8.22 | MIT |
| `scopeguard` | 1.2.0 | MIT OR Apache-2.0 |
| `seahash` | 4.1.0 | MIT |
| `security-framework` | 3.7.0 | MIT OR Apache-2.0 |
| `security-framework-sys` | 2.17.0 | MIT OR Apache-2.0 |
| `selectors` | 0.36.1 | MPL-2.0 |
| `semver` | 1.0.28 | MIT OR Apache-2.0 |
| `serde-untagged` | 0.1.9 | MIT OR Apache-2.0 |
| `serde_core` | 1.0.228 | MIT OR Apache-2.0 |
| `serde_derive` | 1.0.228 | MIT OR Apache-2.0 |
| `serde_derive_internals` | 0.29.1 | MIT OR Apache-2.0 |
| `serde_repr` | 0.1.20 | MIT OR Apache-2.0 |
| `serde_spanned` | 0.6.9, 1.1.1 | MIT OR Apache-2.0 |
| `serde_with` | 3.21.0 | MIT OR Apache-2.0 |
| `serde_with_macros` | 3.21.0 | MIT OR Apache-2.0 |
| `serialize-to-javascript` | 0.1.2 | MIT OR Apache-2.0 |
| `serialize-to-javascript-impl` | 0.1.2 | MIT OR Apache-2.0 |
| `servo_arc` | 0.4.3 | MIT OR Apache-2.0 |
| `shlex` | 2.0.1 | MIT OR Apache-2.0 |
| `simd-adler32` | 0.3.9 | MIT |
| `simd_cesu8` | 1.1.1 | Apache-2.0 OR MIT |
| `simdutf8` | 0.1.5 | MIT OR Apache-2.0 |
| `siphasher` | 1.0.3 | MIT/Apache-2.0 |
| `slab` | 0.4.12 | MIT |
| `smallvec` | 1.15.2 | MIT OR Apache-2.0 |
| `socket2` | 0.6.4 | MIT OR Apache-2.0 |
| `softbuffer` | 0.4.8 | MIT OR Apache-2.0 |
| `soup3` | 0.5.0 | MIT |
| `soup3-sys` | 0.5.0 | MIT |
| `stable_deref_trait` | 1.2.1 | MIT OR Apache-2.0 |
| `string_cache` | 0.9.0 | MIT OR Apache-2.0 |
| `string_cache_codegen` | 0.6.1 | MIT OR Apache-2.0 |
| `strsim` | 0.11.1 | MIT |
| `subtle` | 2.6.1 | BSD-3-Clause |
| `swift-rs` | 1.0.7 | MIT OR Apache-2.0 |
| `syn` | 1.0.109, 2.0.118 | MIT OR Apache-2.0 |
| `sync_wrapper` | 1.0.2 | Apache-2.0 |
| `synstructure` | 0.13.2 | MIT |
| `system-deps` | 6.2.2 | MIT OR Apache-2.0 |
| `tao` | 0.35.3 | Apache-2.0 |
| `tao-macros` | 0.1.3 | MIT OR Apache-2.0 |
| `tap` | 1.0.1 | MIT |
| `tar` | 0.4.46 | MIT OR Apache-2.0 |
| `target-lexicon` | 0.12.16 | Apache-2.0 WITH LLVM-exception |
| `tauri-codegen` | 2.6.3 | Apache-2.0 OR MIT |
| `tauri-macros` | 2.6.3 | Apache-2.0 OR MIT |
| `tauri-plugin` | 2.6.3 | Apache-2.0 OR MIT |
| `tauri-runtime` | 2.11.3 | Apache-2.0 OR MIT |
| `tauri-runtime-wry` | 2.11.4 | Apache-2.0 OR MIT |
| `tauri-utils` | 2.9.3 | Apache-2.0 OR MIT |
| `tauri-winres` | 0.3.6 | MIT |
| `tempfile` | 3.27.0 | MIT OR Apache-2.0 |
| `tendril` | 0.5.0 | MIT OR Apache-2.0 |
| `thiserror` | 1.0.69, 2.0.18 | MIT OR Apache-2.0 |
| `thiserror-impl` | 1.0.69, 2.0.18 | MIT OR Apache-2.0 |
| `time` | 0.3.53 | MIT OR Apache-2.0 |
| `time-core` | 0.1.9 | MIT OR Apache-2.0 |
| `time-macros` | 0.2.31 | MIT OR Apache-2.0 |
| `tinystr` | 0.8.3 | Unicode-3.0 |
| `tinyvec` | 1.11.0 | Zlib OR Apache-2.0 OR MIT |
| `tinyvec_macros` | 0.1.1 | MIT OR Apache-2.0 OR Zlib |
| `tokio` | 1.52.3 | MIT |
| `tokio-rustls` | 0.26.4 | MIT OR Apache-2.0 |
| `tokio-util` | 0.7.18 | MIT |
| `toml` | 0.8.2, 0.9.12+spec-1.1.0, 1.1.2+spec-1.1.0 | MIT OR Apache-2.0 |
| `toml_datetime` | 0.6.3, 0.7.5+spec-1.1.0, 1.1.1+spec-1.1.0 | MIT OR Apache-2.0 |
| `toml_edit` | 0.19.15, 0.20.2, 0.25.12+spec-1.1.0 | MIT OR Apache-2.0 |
| `toml_parser` | 1.1.2+spec-1.1.0 | MIT OR Apache-2.0 |
| `toml_writer` | 1.1.1+spec-1.1.0 | MIT OR Apache-2.0 |
| `tower` | 0.5.3 | MIT |
| `tower-http` | 0.6.11 | MIT |
| `tower-layer` | 0.3.3 | MIT |
| `tower-service` | 0.3.3 | MIT |
| `tracing` | 0.1.44 | MIT |
| `tracing-core` | 0.1.36 | MIT |
| `tray-icon` | 0.24.1 | MIT OR Apache-2.0 |
| `try-lock` | 0.2.5 | MIT |
| `typeid` | 1.0.3 | MIT OR Apache-2.0 |
| `typenum` | 1.20.1 | MIT OR Apache-2.0 |
| `unic-char-property` | 0.9.0 | MIT/Apache-2.0 |
| `unic-char-range` | 0.9.0 | MIT/Apache-2.0 |
| `unic-common` | 0.9.0 | MIT/Apache-2.0 |
| `unic-ucd-ident` | 0.9.0 | MIT/Apache-2.0 |
| `unic-ucd-version` | 0.9.0 | MIT/Apache-2.0 |
| `unicode-ident` | 1.0.24 | (MIT OR Apache-2.0) AND Unicode-3.0 |
| `unicode-segmentation` | 1.13.3 | MIT OR Apache-2.0 |
| `untrusted` | 0.9.0 | ISC |
| `url` | 2.5.8 | MIT OR Apache-2.0 |
| `urlpattern` | 0.3.0 | MIT |
| `utf-8` | 0.7.6 | MIT OR Apache-2.0 |
| `utf8-width` | 0.1.8 | MIT |
| `utf8_iter` | 1.0.4 | Apache-2.0 OR MIT |
| `uuid` | 1.23.4 | Apache-2.0 OR MIT |
| `value-bag` | 1.12.0 | Apache-2.0 OR MIT |
| `vcpkg` | 0.2.15 | MIT/Apache-2.0 |
| `version-compare` | 0.2.1 | MIT |
| `version_check` | 0.9.5 | MIT/Apache-2.0 |
| `vswhom` | 0.1.0 | MIT |
| `vswhom-sys` | 0.1.3 | MIT |
| `walkdir` | 2.5.0 | Unlicense/MIT |
| `want` | 0.3.1 | MIT |
| `wasi` | 0.11.1+wasi-snapshot-preview1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| `wasip2` | 1.0.4+wasi-0.2.12 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| `wasm-bindgen` | 0.2.126 | MIT OR Apache-2.0 |
| `wasm-bindgen-futures` | 0.4.76 | MIT OR Apache-2.0 |
| `wasm-bindgen-macro` | 0.2.126 | MIT OR Apache-2.0 |
| `wasm-bindgen-macro-support` | 0.2.126 | MIT OR Apache-2.0 |
| `wasm-bindgen-shared` | 0.2.126 | MIT OR Apache-2.0 |
| `wasm-streams` | 0.5.0 | MIT OR Apache-2.0 |
| `web-sys` | 0.3.103 | MIT OR Apache-2.0 |
| `web_atoms` | 0.2.5 | MIT OR Apache-2.0 |
| `webkit2gtk` | 2.0.2 | MIT |
| `webkit2gtk-sys` | 2.0.2 | MIT |
| `webpki-root-certs` | 1.0.8 | CDLA-Permissive-2.0 |
| `webview2-com` | 0.38.2 | MIT |
| `webview2-com-macros` | 0.8.1 | MIT |
| `webview2-com-sys` | 0.38.2 | MIT |
| `winapi` | 0.3.9 | MIT/Apache-2.0 |
| `winapi-i686-pc-windows-gnu` | 0.4.0 | MIT/Apache-2.0 |
| `winapi-util` | 0.1.11 | Unlicense OR MIT |
| `winapi-x86_64-pc-windows-gnu` | 0.4.0 | MIT/Apache-2.0 |
| `window-vibrancy` | 0.6.0 | Apache-2.0 OR MIT |
| `windows` | 0.61.3 | MIT OR Apache-2.0 |
| `windows-collections` | 0.2.0 | MIT OR Apache-2.0 |
| `windows-core` | 0.61.2, 0.62.2 | MIT OR Apache-2.0 |
| `windows-future` | 0.2.1 | MIT OR Apache-2.0 |
| `windows-implement` | 0.60.2 | MIT OR Apache-2.0 |
| `windows-interface` | 0.59.3 | MIT OR Apache-2.0 |
| `windows-link` | 0.1.3, 0.2.1 | MIT OR Apache-2.0 |
| `windows-numerics` | 0.2.0 | MIT OR Apache-2.0 |
| `windows-result` | 0.3.4, 0.4.1 | MIT OR Apache-2.0 |
| `windows-strings` | 0.4.2, 0.5.1 | MIT OR Apache-2.0 |
| `windows-sys` | 0.45.0, 0.48.0, 0.52.0, 0.59.0, 0.60.2, 0.61.2 | MIT OR Apache-2.0 |
| `windows-targets` | 0.42.2, 0.48.5, 0.52.6, 0.53.5 | MIT OR Apache-2.0 |
| `windows-threading` | 0.1.0 | MIT OR Apache-2.0 |
| `windows-version` | 0.1.7 | MIT OR Apache-2.0 |
| `windows_aarch64_gnullvm` | 0.42.2, 0.48.5, 0.52.6, 0.53.1 | MIT OR Apache-2.0 |
| `windows_aarch64_msvc` | 0.42.2, 0.48.5, 0.52.6, 0.53.1 | MIT OR Apache-2.0 |
| `windows_i686_gnu` | 0.42.2, 0.48.5, 0.52.6, 0.53.1 | MIT OR Apache-2.0 |
| `windows_i686_gnullvm` | 0.52.6, 0.53.1 | MIT OR Apache-2.0 |
| `windows_i686_msvc` | 0.42.2, 0.48.5, 0.52.6, 0.53.1 | MIT OR Apache-2.0 |
| `windows_x86_64_gnu` | 0.42.2, 0.48.5, 0.52.6, 0.53.1 | MIT OR Apache-2.0 |
| `windows_x86_64_gnullvm` | 0.42.2, 0.48.5, 0.52.6, 0.53.1 | MIT OR Apache-2.0 |
| `windows_x86_64_msvc` | 0.42.2, 0.48.5, 0.52.6, 0.53.1 | MIT OR Apache-2.0 |
| `winnow` | 0.5.40, 0.7.15, 1.0.3 | MIT |
| `winreg` | 0.55.0 | MIT |
| `wit-bindgen` | 0.57.1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| `writeable` | 0.6.3 | Unicode-3.0 |
| `wry` | 0.55.1 | Apache-2.0 OR MIT |
| `wyz` | 0.5.1 | MIT |
| `x11` | 2.21.0 | MIT |
| `x11-dl` | 2.21.0 | MIT |
| `xattr` | 1.6.1 | MIT OR Apache-2.0 |
| `yoke` | 0.8.3 | Unicode-3.0 |
| `yoke-derive` | 0.8.2 | Unicode-3.0 |
| `zerocopy` | 0.8.52 | BSD-2-Clause OR Apache-2.0 OR MIT |
| `zerocopy-derive` | 0.8.52 | BSD-2-Clause OR Apache-2.0 OR MIT |
| `zerofrom` | 0.1.8 | Unicode-3.0 |
| `zerofrom-derive` | 0.1.7 | Unicode-3.0 |
| `zeroize` | 1.9.0 | Apache-2.0 OR MIT |
| `zerotrie` | 0.2.4 | Unicode-3.0 |
| `zerovec` | 0.11.6 | Unicode-3.0 |
| `zerovec-derive` | 0.11.3 | Unicode-3.0 |
| `zip` | 4.6.1 | MIT |
| `zmij` | 1.0.21 | MIT |
