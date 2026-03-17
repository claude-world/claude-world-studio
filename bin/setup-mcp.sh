#!/usr/bin/env bash
set -e

# Setup MCP servers for Claude World Studio
#   setup-mcp              Auto-detect best method (uvx preferred)
#   setup-mcp --update     Update installed servers
#   setup-mcp --venv       Force clone + venv (legacy mode)

UPDATE=false
FORCE_VENV=false
for arg in "$@"; do
  case "$arg" in
    --update|-u) UPDATE=true ;;
    --venv)      FORCE_VENV=true ;;
  esac
done

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
skip() { echo -e "${YELLOW}→${NC} $1"; }
info() { echo -e "${YELLOW}↻${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; }

# ─── Check: uvx available? ───
HAS_UVX=false
if command -v uvx &>/dev/null && [ "$FORCE_VENV" = false ]; then
  HAS_UVX=true
  ok "uvx $(uvx --version 2>/dev/null | head -1)"
fi

# ─── uvx mode (preferred) ───
if $HAS_UVX; then
  echo ""
  echo "Installing MCP servers via uvx (no clone needed)..."
  echo ""

  # Pre-install to uvx cache
  uvx --from 'trend-pulse[mcp]' trend-pulse-server --help &>/dev/null && ok "trend-pulse" || fail "trend-pulse"
  uvx --from cf-browser-mcp cf-browser-mcp --help &>/dev/null && ok "cf-browser" || fail "cf-browser"
  uvx --from notebooklm-skill notebooklm-mcp --help &>/dev/null && ok "notebooklm" || fail "notebooklm"

  echo ""
  echo -e "${GREEN}Done!${NC} All MCP servers cached via uvx."
  echo "Studio will auto-detect uvx and use it — no path config needed."
  echo ""
  echo "  For Claude Code CLI:  uvx config is in .mcp.json"
  echo "  For Claude App (Mac): add to ~/Library/Application Support/Claude/claude_desktop_config.json"
  echo ""
  echo "  Example (Claude App):"
  echo '    "trend-pulse": {'
  echo '      "command": "uvx",'
  echo '      "args": ["--from", "trend-pulse[mcp]", "trend-pulse-server"]'
  echo '    }'
  echo ""
  exit 0
fi

# ─── Legacy venv mode ───

# Check Python
if ! command -v python3 &>/dev/null; then
  fail "python3 not found. Install Python 3.10+ or uv (https://docs.astral.sh/uv/)."
  exit 1
fi

PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
ok "Python $PYTHON_VERSION (legacy venv mode)"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MCP_DIR="$PROJECT_DIR/mcp-servers"

mkdir -p "$MCP_DIR"
echo ""
if $UPDATE; then
  echo "Updating MCP servers in: $MCP_DIR"
else
  echo "Installing MCP servers to: $MCP_DIR"
fi
echo ""

# --- Helper: install or update a repo ---
setup_repo() {
  local name="$1" repo="$2" venv_dir="$3" install_cmd="$4" check_file="$5"

  if $UPDATE && [ -d "$MCP_DIR/$name/.git" ]; then
    info "Updating $name..."
    cd "$MCP_DIR/$name"
    local before=$(git rev-parse HEAD)
    git pull --ff-only origin main 2>/dev/null || git pull --ff-only 2>/dev/null || true
    local after=$(git rev-parse HEAD)
    if [ "$before" != "$after" ]; then
      cd "$MCP_DIR/$name/$venv_dir"
      eval "$install_cmd"
      local commits=$(git log --oneline "$before..$after" | wc -l | tr -d ' ')
      ok "$name updated ($commits new commits)"
    else
      ok "$name already up to date"
    fi
  elif [ -f "$MCP_DIR/$name/$check_file" ]; then
    skip "$name (already installed, use --update to upgrade)"
  else
    echo "Installing $name..."
    git clone --depth 1 "$repo" "$MCP_DIR/$name" 2>/dev/null || true
    cd "$MCP_DIR/$name/$venv_dir"
    python3 -m venv .venv
    eval "$install_cmd"
    ok "$name installed"
  fi
}

# --- trend-pulse ---
setup_repo \
  "trend-pulse" \
  "https://github.com/claude-world/trend-pulse.git" \
  "." \
  ".venv/bin/pip install -q -e '.[mcp]'" \
  ".venv/bin/python"

# --- cf-browser (SDK + MCP server) ---
setup_repo \
  "cf-browser" \
  "https://github.com/claude-world/cf-browser.git" \
  "mcp-server" \
  ".venv/bin/pip install -q -e ../sdk && .venv/bin/pip install -q -e ." \
  "mcp-server/.venv/bin/python"

# --- notebooklm-skill ---
setup_repo \
  "notebooklm-skill" \
  "https://github.com/claude-world/notebooklm-skill.git" \
  "." \
  ".venv/bin/pip install -q notebooklm-py playwright fastmcp python-dotenv httpx" \
  "mcp-server/server.py"

echo ""
if $UPDATE; then
  echo -e "${GREEN}All MCP servers updated.${NC} Restart Studio to use new versions."
else
  echo -e "${GREEN}Done!${NC} Start Studio and click ${YELLOW}Scan System${NC} in Settings to auto-detect."
fi
echo ""
echo "  Tip: Install uv (https://docs.astral.sh/uv/) for simpler setup next time."
echo ""
