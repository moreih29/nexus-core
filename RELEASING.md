# Releasing `@moreih29/nexus-core`

> **Audience**: LLM agents running in any harness (Claude Code, OpenCode, or other).
> Human maintainers can follow the same checklist.
>
> This document is **git-repo-only** and not published to npm. Access via file
> read (when running in a clone) or WebFetch of the GitHub raw URL.

This guide covers everything needed to cut a release of `@moreih29/nexus-core`.
Follow the sections in order. Do not skip the pre-flight checklist.

---

## 0. One-time setup (already done — do NOT repeat)

These are prerequisites that the current maintainer has already configured.
An LLM agent performing a release does not need to do any of these:

- **npm Trusted Publisher registered** for `moreih29/nexus-core` + `publish-npm.yml`
- **npm Publishing access** set to "Require 2FA and disallow tokens (recommended)"
- GitHub Actions secret `NPM_TOKEN` **removed**
- Granular Access Token **revoked**
- Auth is now OIDC-only (no long-lived credentials anywhere)

If for any reason these were not configured, stop and consult the human maintainer.

---

## 1. Pre-flight checklist

Run **all** of these before touching any file. Stop immediately if any fails.

```bash
# Current working directory must be the repo root
cd <path-to-nexus-core>

# Must be on main and clean
git rev-parse --abbrev-ref HEAD   # expect: main
git status --porcelain            # expect: empty

# Pull latest
git fetch origin
git pull origin main

# Install deps and verify
bun install --frozen-lockfile
bun run typecheck                 # expect: 0 errors
bun run validate                  # expect: "All N validation gates passed." (zero errors)
```

If any of the above fails, **stop** and surface the error to the user. Do
not attempt to fix silently.

---

## 1.5. Create a feature branch

All release work happens on a dedicated feature branch — never directly
on main. The feature branch isolates in-progress release commits and
allows multiple preparatory commits (version bump, CHANGELOG, manifest
regen, context/memory updates) to accumulate before they land on main
together. main is updated only via the `--no-ff` merge in §4b.

Naming convention:

```bash
git checkout -b feat/vX_Y_Z-<short-slug>
```

Recent examples:
- `feat/v0_11_0-hook-injection-governance`
- `feat/v0_12_0-runtime-injection-withdrawal`

The slug describes the release's primary theme. Use underscores between
the version segments (`v0_12_0`, not `v0.12.0`) to avoid branch-name dots
— both forms appear in older history, but underscore is the current
convention.

---

## 2. Decide the version number

Read `.nexus/rules/semver-policy.md` — the 18-case table tells you whether
a given change is `patch` / `minor` / `major`.

**Key rules of thumb** (the full table is authoritative):
- Added a new agent or skill → **minor**
- Removed or renamed an existing agent/skill → **major**
- Changed a body.md or README prose without altering behavior → **patch**
- Changed CI or docs only (no consumer-visible file changes) → **patch**
- Added a capability entry without applying it anywhere → **patch**
- Made an `additionalProperties: false` schema stricter → **major**
- In doubt, **prefer `minor` over `patch`** (the heuristic `semver-policy.md`
  calls "doubt → minor")

Note: `0.x.y` caret ranges in consumer `package.json` only allow patch
updates (`^0.1.0` matches `0.1.x` but not `0.2.0`). This makes minor
bumps in `0.x` effectively breaking in practice. Factor this into your
decision.

---

## 3. Prepare the release commit

### 3a. Bump version strings (`package.json` + `VERSION`)

Update **both** files to the same `X.Y.Z` value. The CI publish workflow
runs a version-match check that fails if `package.json.version` and the
git tag disagree, and `VERSION` is the plain-text single-line source of
truth consumed by tooling and documentation. The two must never drift.

Edit `package.json`:

```json
"version": "X.Y.Z"
```

Edit `VERSION` (repo root, single line):

```
X.Y.Z
```

### 3b. Update `CHANGELOG.md`

The file follows Keep a Changelog format with `nx-car:vX.Y.Z:start/end`
markers for machine-readable breaking change extraction.

Template for a new section (insert **above** the previous most-recent version):

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- (if any)

### Changed
- (if any)

### Deprecated
- (if any)

### Removed
- (if any)

### Fixed
- (if any)

### Security
- (if any)

### BREAKING CHANGES
<!-- nx-car:vX.Y.Z:start -->
<!-- Remove this block if there are no breaking changes. -->
- **type**: what changed
- **impact**: which consumer surfaces are affected
- **action**: what consumers must do
- **migration**: see MIGRATIONS/vA_to_vB.md (if applicable)
<!-- nx-car:vX.Y.Z:end -->
```

Fill in every subsection that has changes; keep the subsection heading and
write `(none)` if there is nothing in that category. Keep the heading
order consistent with the existing file.

Also update the CHANGELOG footer comparison links (Keep a Changelog
convention). Failing to do so leaves consumers without a `vX.Y.Z` compare
link and a stale `[Unreleased]` pointer:

- `[Unreleased]` → `compare/vX.Y.Z...HEAD` (repoint to the new version)
- Insert `[X.Y.Z]: compare/v<prev>...vX.Y.Z` above the previous version's
  entry

### 3c. Large migrations (50+ lines) and `MIGRATIONS/INDEX.md`

If the BREAKING CHANGES block would exceed ~50 lines, create a separate
file at `MIGRATIONS/v{from_major.minor}_to_v{to_major.minor}.md` with the
full guide, and reference it from the nx-car block (`- **migration**: See
MIGRATIONS/v0.1_to_v0.2.md`).

**Whenever you create a new `MIGRATIONS/vA_to_vB.md` file, you MUST also
add a matching entry to `MIGRATIONS/INDEX.md` in the same commit.** The
index is the chronological release → migration mapping that consumer LLM
agents use as the entry point for migration discovery. Deferring the
index update has caused multi-release drift in the past; treat it as a
non-optional step, not a follow-up.

**MIGRATIONS is append-only** — never modify an existing migration file
after its release has shipped.

### 3d. Release-affected file inventory (cycle-dependent)

Beyond the minimum files in §3a–§3c, review whether this release cycle
modified any of the following. If so, they must be staged in the release
commit (§4) — omitting them leaves the context/memory/rules layer out of
sync with the published version:

- [ ] `.nexus/context/evolution.md` — append a `### vX.Y.Z — <summary>
  (YYYY-MM-DD)` subsection describing the release's governance rationale.
  Convention: every release gets a subsection here for historical
  archaeology. If the current release reverses or amends a prior
  release's decision, also append a regression-noting paragraph to the
  affected prior subsection (e.g. `§v0.11.0`).
- [ ] `.nexus/context/boundaries.md` — stage if this release introduces
  or modifies a domain boundary, canonical specifics threshold, or
  rejection rule.
- [ ] `.nexus/context/ecosystem.md` — stage if consumer list, layer
  structure, or core relationship model changed.
- [ ] `.nexus/rules/*.md` — stage if a new enforceable rule was added or
  an existing one was amended.
- [ ] `.nexus/memory/pattern-*.md` — stage new pattern memos produced
  during the plan/release cycle (retrospectives, design-time checklists).

Not every release touches all of the above; stage only the files with
real diffs. Running `git status --short` before §4 confirms the exact
set.

### 3e. Regenerate `manifest.json`

`manifest.json` contains `nexus_core_version` and the git commit SHA plus
a `body_hash` for each agent and skill. It is regenerated automatically
by `bun run validate`:

```bash
bun run validate
```

Verify the top of `manifest.json`:
- `nexus_core_version` should now equal your new `X.Y.Z`
- `nexus_core_commit` will reference the **previous** HEAD (this is OK —
  the release commit will itself include the updated manifest, and CI
  regenerates it again on tag push from within the tag commit)

### 3f. Pre-commit sanity check

Before staging, verify the release's internal references agree. Any
mismatch here will either fail the CI `Version match check` step or
leave consumer-facing references broken:

- `cat VERSION` == `package.json.version` == new `X.Y.Z`
- `CHANGELOG.md` top entry heading starts with `## [X.Y.Z]`
- `manifest.json.nexus_core_version` == new `X.Y.Z`
- CHANGELOG footer `[Unreleased]` and `[X.Y.Z]` links point to the new
  version
- If a new `MIGRATIONS/vA_to_vB.md` file was created in this cycle, a
  matching row exists in `MIGRATIONS/INDEX.md`
- Every file in §3d whose diff is non-empty is about to be staged

Fix any discrepancy before proceeding to §4.

---

## 4. Commit, merge to main, tag, push tag

### 4a. Commit on the feature branch

Stage the **exact** files you modified (no `git add -A`):

```bash
# Minimum — every release bumps these four:
git add package.json VERSION CHANGELOG.md manifest.json

# Conditional — stage if modified in this cycle (see §3d):
# git add .nexus/context/evolution.md
# git add .nexus/context/boundaries.md
# git add .nexus/context/ecosystem.md
# git add .nexus/rules/*.md
# git add .nexus/memory/pattern-*.md
# git add MIGRATIONS/vA_to_vB.md MIGRATIONS/INDEX.md
```

**Commit message convention**: use a Conventional Commits prefix chosen
by the release's primary character, followed by `vX.Y.Z` and a short
summary. Recent releases consistently use `feat:` when the release
introduces or changes functionality (e.g. `feat: v0.12.0 — §9 runtime
injection 메커니즘 회수`). Use `fix:` for pure bug-fix releases, `docs:`
for docs-only patch bumps, `chore:` for mechanical version bumps with no
user-visible behavior change.

```bash
git commit -m "feat: vX.Y.Z — <short description>"
```

Multiple commits on the feature branch are acceptable; the `--no-ff`
merge in §4b preserves them all in main's history. It is fine to split
the release into e.g. a primary `feat:` commit and a follow-up `fix:` or
`chore:` commit before merging.

### 4b. Merge the feature branch into main

```bash
git checkout main
git pull origin main                              # ensure up to date
git merge --no-ff feat/vX_Y_Z-<slug> \
  -m "Merge feat/vX_Y_Z-<slug> into main — vX.Y.Z"
```

The `--no-ff` flag **always** creates a merge commit — never
fast-forward. This merge commit is the canonical release boundary in
git history (every past release has one). Deleting the feature branch
after merge is optional:

```bash
git branch -d feat/vX_Y_Z-<slug>                  # local
git push origin --delete feat/vX_Y_Z-<slug>       # remote, if pushed
```

### 4c. Push main and create the tag

```bash
git push origin main
git tag -a vX.Y.Z -m "vX.Y.Z: <short description>"
git push origin vX.Y.Z
```

The tag pattern `v[0-9]+.[0-9]+.[0-9]+` (pure semver, no prerelease)
triggers `.github/workflows/publish-npm.yml`. Tag the merge commit on
main, not any intermediate commit on the feature branch.

---

## 5. Watch the publish workflow

```bash
gh run watch $(gh run list --workflow=publish-npm.yml --limit 1 --json databaseId --jq '.[0].databaseId') --exit-status
```

Expected steps, all green, under 30 seconds total:

1. Checkout
2. Setup Bun (1.3.x)
3. Setup Node 24 (bundled npm 11+ required for OIDC)
4. Install dependencies
5. Run validation (all gates)
6. Version match check (git tag vs package.json)
7. Pack (dry-run verification)
8. Publish to npm (OIDC Trusted Publishing)

If it fails, jump to [§8 Troubleshooting](#8-troubleshooting).

---

## 6. Post-publish verification

```bash
npm view @moreih29/nexus-core@X.Y.Z dist --json
```

Expected output contains:
- `"attestations": { ..., "provenance": { "predicateType": "https://slsa.dev/provenance/v1" } }`
- `"signatures": [ { ... } ]`
- `"tarball": "https://registry.npmjs.org/@moreih29/nexus-core/-/nexus-core-X.Y.Z.tgz"`
- `"fileCount"` should match your local `bun publish --dry-run` count

Also verify the full version list includes the new one:

```bash
npm view @moreih29/nexus-core versions --json
```

---

## 7. Hard rules — **DO NOT**

These rules exist because each one has caused a real failure at least once
during the bootstrap phase. Treat them as inviolate.

- **DO NOT** force-push `main`. Tag force-update was allowed during the
  initial `v0.1.0 → v0.1.1` bootstrap but **is no longer acceptable** for
  published tags. If a published tag points at a broken commit, bump the
  patch version and release the fix.
- **DO NOT** amend commits that have been pushed. Always create a new
  commit.
- **DO NOT** re-publish the same version number to npm. npm has a 24-hour
  unpublish window and rejects re-publishing the same version after that.
- **DO NOT** skip `bun run validate` before committing. The manifest must
  be regenerated and all gates must pass.
- **DO NOT** edit `manifest.json` by hand. It is an artifact of
  `bun run validate`. Any manual edit will desync and fail
  `schema/manifest.schema.json`.
- **DO NOT** add anything to `package.json.dependencies`. nexus-core is a
  prompt-only library; the `dependencies` field must remain absent.
  (`devDependencies` is fine.)
- **DO NOT** add `registry-url` to the `setup-node` step in
  `publish-npm.yml`. It auto-injects `NODE_AUTH_TOKEN` and routes publish
  through token auth, which is no longer permitted by the npm access
  policy on this package.
- **DO NOT** add `NODE_AUTH_TOKEN` or any other credential env to the
  publish step. OIDC is token-free by design.
- **DO NOT** switch the publish command to `bun publish`. It does not
  read `NPM_CONFIG_USERCONFIG` and does not participate in OIDC in the
  same way. Use `npm publish --provenance --access public`. The Bun
  publish evaluation is reserved for a 6-month review
  (see `.nexus/context/evolution.md`).
- **DO NOT** downgrade `node-version` below `24` in `publish-npm.yml`.
  npm Trusted Publishing (OIDC) requires npm >= 11.5.1, which is bundled
  with Node 24 and later only.
- **DO NOT** push runtime code (`.ts` / `.js` / `.cjs` / `.mjs`) anywhere
  outside `scripts/`. G8 `prompt-only` gate will fail.
- **DO NOT** include harness-specific tool names in `agents/*/meta.yml`,
  `skills/*/meta.yml`, `vocabulary/*.yml`, or `body.md` files. The
  exact forbidden patterns are defined in `scripts/lib/lint.ts`
  (`CLAUDE_CODE_TOOLS_DISTINCTIVE`, `CLAUDE_CODE_TOOLS_AMBIGUOUS`,
  `OPENCODE_TOOLS` regexes). Distinctive tool names are checked in all
  lint-included files; ambiguous ones (common English words) are checked
  in `meta.yml` and `vocabulary/*.yml` only. G6 gate will fail on
  violations. Refer to `lint.ts` for the authoritative pattern list.
- **DO NOT** include concrete model names (`opus`, `sonnet`, `haiku`,
  `gpt-*`, `claude-*`) in `meta.yml` files. Use `model_tier: high` or
  `model_tier: standard`. G7 gate will fail.

---

## 8. Troubleshooting

### Validation / local checks

| Symptom | Cause | Fix |
|---|---|---|
| `bun run validate` reports G1 schema error in a `meta.yml` | Missing required field or type mismatch | Read the AJV error, cross-reference `schema/{agent,skill,vocabulary}.schema.json`, fix the meta.yml |
| G6 `harness-lint` error on body.md | Distinctive tool name found in prose | Replace with neutral phrasing. Check `scripts/lib/lint.ts` for the distinctive vs ambiguous tool name split — only distinctive names are checked in body.md. |
| G9 `directory-strict` error | Extra file in `agents/{id}/` or `skills/{id}/` | Remove the extra file. Only `body.md` and `meta.yml` are allowed |
| G10 `id-match` error | `meta.yml.id` != directory name, or id violates `^[a-z][a-z0-9_-]*$` | Rename directory or edit `meta.yml.id` |
| `tsc --noEmit` AJV type error | Used `ajv.getSchema()` return value as `Ajv['validate']` | Use `ValidateFunction` type from `ajv` |

### Publish workflow

| Symptom | Cause | Fix |
|---|---|---|
| `error: missing authentication (run bunx npm login)` | Using `bun publish` | Switch to `npm publish --provenance --access public` (see Hard Rules) |
| `npm error code ENEEDAUTH` | npm version < 11, OIDC not available | Use Node 24 (`node-version: 24`) so npm 11+ is bundled |
| `Cannot find module 'promise-retry'` during `npm install -g npm@latest` | npm self-upgrade bug | Do not self-upgrade npm; use Node 24 instead |
| `404 Not Found - PUT ...nexus-core` | `setup-node` has `registry-url` set, injects `NODE_AUTH_TOKEN`, which takes precedence over OIDC and the token is now invalid | Remove `registry-url` from `setup-node` |
| `Version mismatch: package.json=X, git tag=Y` | `package.json.version` not bumped, or tag created before commit | Fix the version, re-commit, then re-create the tag (or bump patch and try again with a new version) |
| `prepublishOnly` fails with validation errors | Something in your uncommitted state fails a gate | Run `bun run validate` locally and fix before pushing |
| Provenance statement is published to sigstore but then PUT fails | OIDC token minted but registry rejects it — Trusted Publisher misconfiguration | Check the npm access page for this package and confirm the Trusted Publisher entry exactly matches `owner=moreih29, repo=nexus-core, workflow=publish-npm.yml, environment=(empty)` |

### Rollback / recovery

If a release is published but broken:

1. **Do not** `npm unpublish` unless you are within the 24-hour window and
   no one has installed the broken version. Even then, prefer option 2.
2. **Prefer**: bump a new patch version with the fix and publish again.
   Mark the broken version as deprecated on npm:
   ```bash
   npm deprecate @moreih29/nexus-core@X.Y.Z "broken release; use X.Y.(Z+1)+"
   ```
3. If the fix reveals a bug in the release pipeline itself (validate
   regression, CI config error, etc.), the fix may require updating
   `scripts/`, schemas, or workflow YAML. These are not `files`-listed
   and do not in themselves trigger a version bump, but the release that
   fixes the observed consumer behavior still needs a version bump.

---

## 9. Reference files

- `package.json` — version, files whitelist, exports, devDeps
- `CHANGELOG.md` — version history (Keep a Changelog format)
- `CONSUMING.md` — what consumer agents read on upgrade
- `.nexus/rules/semver-policy.md` — 18-case semver interpretation table
- `.nexus/context/evolution.md` — release policy (Forward-only relaxation,
  Phase 1/2, transient bootstrap, 90-day re-eval indicators, Bun publish
  6-month re-eval reservation)
- `.nexus/context/boundaries.md` — file inventory and field definitions
- `.github/workflows/publish-npm.yml` — the CI pipeline this document describes
- `.github/workflows/validate.yml` — the PR/push validation pipeline

## 10. When in doubt

Stop and surface the situation to the human maintainer before making any
destructive changes. A release that sits for an hour while you ask a
question is always better than a broken release that ships in a minute.
