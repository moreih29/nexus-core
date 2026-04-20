#!/usr/bin/env bash
# Codex plugin installer — block-marker merge pattern.
# nexus-core Model 2: wrapper owns integration seams.
# Merges config.fragment.toml into ~/.codex/config.toml,
# copies native agent TOMLs to ~/.codex/agents/,
# and merges AGENTS.fragment.md into ~/.codex/AGENTS.md.
set -euo pipefail

PLUGIN_NAME="${PLUGIN_NAME:-codex-nexus}"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

mkdir -p "$CODEX_HOME" "$CODEX_HOME/agents" "$CODEX_HOME/plugins"

# 1. config.toml — block-marker merge
MARKER_BEGIN="# BEGIN ${PLUGIN_NAME}"
MARKER_END="# END ${PLUGIN_NAME}"
CONFIG="$CODEX_HOME/config.toml"
CONFIG_FRAGMENT="$SCRIPT_DIR/config.fragment.toml"

touch "$CONFIG"
if grep -q "${MARKER_BEGIN}" "$CONFIG" 2>/dev/null; then
  sed -i.bak "/${MARKER_BEGIN}/,/${MARKER_END}/d" "$CONFIG"
fi
{
  echo ""
  echo "${MARKER_BEGIN}"
  cat "$CONFIG_FRAGMENT"
  echo "${MARKER_END}"
} >> "$CONFIG"

# 2. native agent TOMLs
cp "$REPO_ROOT"/agents/*.toml "$CODEX_HOME/agents/" 2>/dev/null || true

# 3. plugin body → ~/.codex/plugins/<name>/
PLUGIN_DEST="$CODEX_HOME/plugins/${PLUGIN_NAME}"
rm -rf "$PLUGIN_DEST"
mkdir -p "$PLUGIN_DEST"
cp -R "$REPO_ROOT"/plugin/. "$PLUGIN_DEST/"

# 4. AGENTS.md — block-marker merge
AGENTS_TARGET="$CODEX_HOME/AGENTS.md"
AGENTS_FRAGMENT="$SCRIPT_DIR/AGENTS.fragment.md"
FRAG_BEGIN="<!-- nexus-core:lead:start -->"
FRAG_END="<!-- nexus-core:lead:end -->"

if [ -f "$AGENTS_FRAGMENT" ]; then
  touch "$AGENTS_TARGET"
  if grep -q "${FRAG_BEGIN}" "$AGENTS_TARGET" 2>/dev/null; then
    awk -v begin="${FRAG_BEGIN}" -v end="${FRAG_END}" '
      $0 ~ begin { skip=1; next }
      $0 ~ end { skip=0; next }
      !skip { print }
    ' "$AGENTS_TARGET" > "$AGENTS_TARGET.tmp" && mv "$AGENTS_TARGET.tmp" "$AGENTS_TARGET"
  fi
  cat "$AGENTS_FRAGMENT" >> "$AGENTS_TARGET"
fi

echo "Installed ${PLUGIN_NAME} → $CODEX_HOME"
