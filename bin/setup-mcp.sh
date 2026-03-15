#!/usr/bin/env bash
set -e

# Setup & update MCP servers for Claude World Studio
#   setup-mcp            Install missing MCP servers
#   setup-mcp --update   Pull latest + reinstall deps

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MCP_DIR="$PROJECT_DIR/mcp-servers"
UPDATE=false
[[ "${1:-}" == "--update" || "${1:-}" == "-u" ]] && UPDATE=true

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
skip() { echo -e "${YELLOW}→${NC} $1 (already installed, use --update to upgrade)"; }
info() { echo -e "${YELLOW}↻${NC} $1"; }
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
    skip "$name"
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

# --- notebooklm-skill (notebooklm-py is the correct PyPI name) ---
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
echo "  claude-world-studio       # start"
echo "  setup-mcp --update        # update later"
