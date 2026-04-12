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

### 3a. Bump `package.json`

Edit `package.json`:

```json
"version": "X.Y.Z"
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

### 3c. Large migrations (50+ lines)

If the BREAKING CHANGES block would exceed ~50 lines, create a separate
file at `MIGRATIONS/v{from_major.minor}_to_v{to_major.minor}.md` with the
full guide, and reference it from the nx-car block (`- **migration**: See
MIGRATIONS/v0.1_to_v0.2.md`). Also add an entry to `MIGRATIONS/INDEX.md`.

**MIGRATIONS is append-only** — never modify an existing migration file
after its release has shipped.

### 3d. Regenerate `manifest.json`

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

---

## 4. Commit, push, tag, push tag

Stage the **exact** files you modified (no `git add -A`):

```bash
git add package.json CHANGELOG.md manifest.json
# If you added a MIGRATIONS file:
# git add MIGRATIONS/vA_to_vB.md MIGRATIONS/INDEX.md

git commit -m "chore(release): vX.Y.Z — <short description>"
git push origin main
```

After the main push lands, create and push the tag:

```bash
git tag -a vX.Y.Z -m "vX.Y.Z: <short description>"
git push origin vX.Y.Z
```

The tag pattern `v[0-9]+.[0-9]+.[0-9]+` (pure semver, no prerelease)
triggers `.github/workflows/publish-npm.yml`.

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
