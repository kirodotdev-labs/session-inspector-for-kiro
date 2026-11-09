#!/usr/bin/env node
// Generates THIRD-PARTY-LICENSES: attribution for all third-party content that
// ships inside the released desktop app.
//
//   pnpm install --frozen-lockfile && node scripts/generate-third-party-licenses.mjs
//
// Requires `cargo-about` (cargo install cargo-about --locked).
//
// - npm: only packages actually bundled into the frontend. A temporary
//   `vite build --sourcemap` is run and the sourcemaps are read to find which
//   node_modules files end up in the output. Build-time-only tools (eslint,
//   typescript, ...) are not distributed and are therefore not listed.
// - Cargo: crates compiled into the binary for every release target
//   (see src-tauri/about.toml), via `cargo about`.
// - Code embedded at build time without being a bundled module (Tailwind CSS
//   preflight, Vite/rolldown runtime helpers) and project-template content.

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outFile = path.join(root, 'THIRD-PARTY-LICENSES')
const rule = '-'.repeat(80)

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts })
  if (r.status !== 0) {
    process.stderr.write(r.stderr || '')
    throw new Error(`${cmd} ${args.join(' ')} failed with exit code ${r.status}`)
  }
  return r.stdout
}

function packageRoot(file) {
  let dir = path.dirname(file)
  while (dir !== path.dirname(dir)) {
    const pj = path.join(dir, 'package.json')
    if (fs.existsSync(pj)) {
      const p = JSON.parse(fs.readFileSync(pj, 'utf8'))
      if (p.name && p.version) return dir
    }
    dir = path.dirname(dir)
  }
  throw new Error(`no package.json found above ${file}`)
}

// --- npm: packages bundled into the frontend --------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-'))
try {
  run('pnpm', ['exec', 'vite', 'build', '--sourcemap', '--emptyOutDir', '--logLevel', 'error', '--outDir', tmp], { cwd: root })
  var pkgDirs = new Set()
  for (const f of fs.readdirSync(tmp, { recursive: true })) {
    if (!f.endsWith('.map')) continue
    const map = JSON.parse(fs.readFileSync(path.join(tmp, f), 'utf8'))
    const base = path.dirname(path.join(tmp, f))
    for (const s of map.sources) {
      if (!s.includes('node_modules')) continue
      pkgDirs.add(fs.realpathSync(packageRoot(path.resolve(base, s))))
    }
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

// Embedded at build time but not visible as bundled modules in sourcemaps.
const req = createRequire(path.join(root, 'package.json'))
const viteDir = path.dirname(req.resolve('vite/package.json'))
const extras = [
  path.dirname(req.resolve('tailwindcss/package.json')), // preflight/utility CSS
  viteDir, // modulepreload polyfill and preload helper
  path.dirname(createRequire(path.join(viteDir, 'package.json')).resolve('rolldown/package.json')), // runtime helpers
]
for (const d of extras) pkgDirs.add(fs.realpathSync(d))

// Vite's LICENSE.md also carries licenses for dependencies bundled into Vite's
// own Node.js build code, which is not shipped in the app. Keep the core part.
const trimLicense = {
  vite: (t) => t.split(/^# Licenses of bundled dependencies/m)[0].trim(),
}

const npmPkgs = [...pkgDirs]
  .map((dir) => {
    const p = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    const files = fs.readdirSync(dir).filter((f) => /^(licen[cs]e|copying|notice)/i.test(f) && fs.statSync(path.join(dir, f)).isFile())
    if (files.length === 0) throw new Error(`${p.name}@${p.version}: no license file found in ${dir}`)
    const texts = files.sort().map((f) => {
      const t = fs.readFileSync(path.join(dir, f), 'utf8').trim()
      return trimLicense[p.name] ? trimLicense[p.name](t) : t
    })
    const repo = typeof p.repository === 'string' ? p.repository : p.repository?.url
    return { name: p.name, version: p.version, license: p.license, url: p.homepage || repo, texts }
  })
  .sort((a, b) => a.name.localeCompare(b.name))

// --- Cargo: crates compiled into the binary ---------------------------------
// cargo-about resolves the crate set (per release target, no build/dev deps)
// and the license chosen for each crate. Its own text for a license is the
// canonical SPDX text, which lacks the crate's copyright line, so the crate's
// own license/notice files are used whenever the crate ships them.
const tauriDir = path.join(root, 'src-tauri')
const aboutRaw = run('cargo', ['about', 'generate', '--locked', '-c', 'about.toml', 'about.hbs'], { cwd: tauriDir })
const meta = JSON.parse(run('cargo', ['metadata', '--locked', '--format-version', '1'], { cwd: tauriDir }))
const metaById = new Map(meta.packages.map((p) => [`${p.name}@${p.version}`, p]))

const crates = new Map()
for (const block of aboutRaw.split(/^@@@LICENSE /m).slice(1)) {
  const id = block.slice(0, block.indexOf('\n')).trim()
  const [head, text] = block.split(/^@@@TEXT\n/m)
  for (const m of head.matchAll(/^@@@CRATE (\S+) (\S+) (.+)$/gm)) {
    const key = `${m[1]}@${m[2]}`
    const c = crates.get(key) ?? { name: m[1], version: m[2], dir: path.dirname(m[3]), canonical: new Map() }
    c.canonical.set(id, text.trim())
    crates.set(key, c)
  }
}

// For multi-licensed crates ("MIT OR Apache-2.0") cargo-about elects one
// license (preferring MIT, see about.toml). Skip files that are clearly for a
// license that was not elected, e.g. LICENSE-APACHE when MIT was chosen.
// NOTICE files and files whose name names no license are always kept.
const licenseFamilies = { apache: 'Apache', mit: 'MIT', bsd: 'BSD', zlib: 'Zlib', isc: 'ISC', mpl: 'MPL', unlicense: 'Unlicense', unicode: 'Unicode', cc0: 'CC0' }
function fileFamily(f) {
  const n = f.toLowerCase().replace(/^licen[cs]e/, '')
  for (const [token, fam] of Object.entries(licenseFamilies)) if (new RegExp(`(^|[^a-z])${token}([^a-z]|$)`).test(n)) return fam
  return null
}

const groups = new Map()
for (const [key, c] of crates) {
  if (fs.realpathSync(c.dir).startsWith(root + path.sep)) continue // this project itself
  const p = metaById.get(key)
  const chosen = [...c.canonical.keys()].join(' ')
  let files = fs
    .readdirSync(c.dir)
    .filter((f) => /^(licen[cs]e|copying|copyright|notice|unlicense)/i.test(f) && fs.statSync(path.join(c.dir, f)).isFile())
    .sort()
  const elected = files.filter((f) => {
    const fam = fileFamily(f)
    return /^notice/i.test(f) || fam === null || chosen.includes(fam)
  })
  if (elected.some((f) => !/^notice/i.test(f))) files = elected
  let texts
  if (files.length) {
    texts = files.map((f) => fs.readFileSync(path.join(c.dir, f), 'utf8').trim())
  } else {
    // The crate ships no license file: use the canonical text and fill in the
    // copyright holders from the crate metadata.
    const holders = p?.authors?.length ? p.authors.join(', ') : `The ${c.name} authors`
    const placeholder = /^\s*Copyright \(c\) <year> <(copyright holders|owner)>\.?\s*$/m
    texts = [...c.canonical.values()].map((t) =>
      placeholder.test(t) ? t.replace(placeholder, `Copyright (c) ${holders}`) : `Copyright (c) ${holders}\n\n${t}`,
    )
  }
  const body = texts.join('\n\n' + '. '.repeat(20).trim() + '\n\n')
  const g = groups.get(body) ?? { body, crates: [] }
  g.crates.push({ name: c.name, version: c.version, license: p?.license, url: p?.repository || p?.homepage })
  groups.set(body, g)
}
const cargoGroups = [...groups.values()]
  .map((g) => ({ ...g, crates: g.crates.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)) }))
  .sort((a, b) => a.crates[0].name.localeCompare(b.crates[0].name))
const cargoCount = cargoGroups.reduce((n, g) => n + g.crates.length, 0)
const cargoText = cargoGroups
  .map((g) => {
    const list = g.crates.map((c) => `  - ${c.name} ${c.version}${c.license ? ` (${c.license})` : ''}${c.url ? `\n      ${c.url}` : ''}`).join('\n')
    return `${'='.repeat(80)}\n${list}\n${'='.repeat(80)}\n\n${g.body}\n`
  })
  .join('\n')

// --- Project template ---------------------------------------------------------
const createViteLicense = `MIT License

Copyright (c) 2019-present, VoidZero Inc. and Vite contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`

// --- Write ----------------------------------------------------------------------
const out = []
out.push(`Kiro Sessions Inspector - Third-Party Licenses

Kiro Sessions Inspector includes the third-party software and content listed
below, which is distributed under the terms of the respective licenses
reproduced here.

This file is generated by scripts/generate-third-party-licenses.mjs. Do not
edit it by hand; re-run the script whenever dependencies change and before
publishing a release.

Contents:
  1. Project template (create-vite)
  2. Frontend (npm) packages bundled into the application (${npmPkgs.length})
  3. Rust crates compiled into the application binary (${cargoCount})
`)

out.push(`${rule}\n1. PROJECT TEMPLATE\n${rule}

Parts of the frontend scaffolding (index.html, build and lint configuration)
were generated from the create-vite "react-ts" template
(https://github.com/vitejs/vite/tree/main/packages/create-vite).

${createViteLicense}
`)

out.push(`${rule}\n2. FRONTEND (npm) PACKAGES\n${rule}\n`)
for (const p of npmPkgs) {
  out.push(`** ${p.name} ${p.version}${p.license ? ` (${p.license})` : ''}${p.url ? `\n   ${p.url.replace(/^git\+/, '')}` : ''}\n\n${p.texts.join('\n\n')}\n`)
}

out.push(`${rule}\n3. RUST CRATES\n${rule}

Note: rusqlite is built with the "bundled" feature, which compiles in the SQLite
library. SQLite is in the public domain (https://www.sqlite.org/copyright.html).

${cargoText}
`)

fs.writeFileSync(outFile, out.join('\n').replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '') + '\n')
console.log(`Wrote ${path.relative(root, outFile)}: ${npmPkgs.length} npm packages, ${cargoCount} Rust crates`)
