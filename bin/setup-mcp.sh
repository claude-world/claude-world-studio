#!/usr/bin/env bash
set -e

# Setup MCP servers for Claude World Studio
# Installs trend-pulse, cf-browser, notebooklm-skill as siblings

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MCP_DIR="$PROJECT_DIR/mcp-servers"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
skip() { echo -e "${YELLOW}→${NC} $1 (already installed)"; }
fail() { echo -e "${RED}✗${NC} $1"; }

# Check Python
if ! command -v python3 &>/dev/null; then
  fail "python3 not found. Install Python 3.10+ first."
  exit 1
fi

PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
ok "Python $PYTHON_VERSION"

mkdir -p "$MCP_DIR"
echo ""
echo "Installing MCP servers to: $MCP_DIR"
echo ""

# --- trend-pulse ---
if [ -f "$MCP_DIR/trend-pulse/.venv/bin/python" ]; then
  skip "trend-pulse"
else
  echo "Installing trend-pulse..."
  git clone --depth 1 https://github.com/claude-world/trend-pulse.git "$MCP_DIR/trend-pulse" 2>/dev/null || true
  cd "$MCP_DIR/trend-pulse"
  python3 -m venv .venv
  .venv/bin/pip install -q -e '.[mcp]'
  ok "trend-pulse → $MCP_DIR/trend-pulse/.venv/bin/python"
fi

# --- cf-browser ---
if [ -f "$MCP_DIR/cf-browser/mcp-server/.venv/bin/python" ]; then
  skip "cf-browser"
else
  echo "Installing cf-browser..."
  git clone --depth 1 https://github.com/claude-world/cf-browser.git "$MCP_DIR/cf-browser" 2>/dev/null || true
  cd "$MCP_DIR/cf-browser/mcp-server"
  python3 -m venv .venv
  .venv/bin/pip install -q -e '.[dev]'
  ok "cf-browser → $MCP_DIR/cf-browser/mcp-server/.venv/bin/python"
fi

# --- notebooklm-skill ---
if [ -f "$MCP_DIR/notebooklm-skill/mcp-server/server.py" ]; then
  skip "notebooklm-skill"
else
  echo "Installing notebooklm-skill..."
  git clone --depth 1 https://github.com/claude-world/notebooklm-skill.git "$MCP_DIR/notebooklm-skill" 2>/dev/null || true
  cd "$MCP_DIR/notebooklm-skill"
  python3 -m venv .venv
  .venv/bin/pip install -q -r requirements.txt
  ok "notebooklm-skill → $MCP_DIR/notebooklm-skill/mcp-server/server.py"
fi

echo ""
echo -e "${GREEN}Done!${NC} Start Studio and click ${YELLOW}Scan System${NC} in Settings to auto-detect."
echo ""
echo "  npm start        # or"
echo "  npx claude-world-studio"
