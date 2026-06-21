#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Transcriber production setup"
echo "    Directory: $ROOT"
echo

# --- checks ---
for cmd in node npm ffmpeg; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: '$cmd' is not installed."
    echo "  Install ffmpeg: sudo apt install -y ffmpeg"
    echo "  Install Node 20: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
    exit 1
  fi
done

echo "Node:   $(node -v)"
echo "npm:    $(npm -v)"
echo "ffmpeg: $(ffmpeg -version 2>&1 | head -1)"
echo

# --- .env ---
if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env
    echo "Created .env from .env.example — edit it before continuing."
    echo "  nano .env"
    exit 1
  fi
  echo "ERROR: .env not found. Copy .env.example to .env and set DATABASE_URL + API keys."
  exit 1
fi

if ! grep -q '^DATABASE_URL=' .env; then
  echo "ERROR: DATABASE_URL is not set in .env"
  exit 1
fi

# --- dirs ---
mkdir -p uploads
chmod 700 .env 2>/dev/null || true

echo "==> Installing dependencies (devDependencies required for build)"
# Do not source .env yet — NODE_ENV=production would skip devDependencies
npm ci --include=dev

# Load .env for build and database steps
# shellcheck disable=SC1091
set -a && source .env && set +a
mkdir -p "${UPLOAD_DIR:-uploads}"

echo "==> Building Next.js app"
npm run build

echo "==> Syncing database schema"
npm run db:sync

echo "==> Seeding keyterms"
npm run db:seed

echo
echo "Setup complete."
echo
echo "Next steps:"
echo "  1. Test manually:  npm run start"
echo "  2. Install service: sudo cp deploy/transcriber.service /etc/systemd/system/"
echo "                     sudo systemctl daemon-reload && sudo systemctl enable --now transcriber"
echo "  3. Configure Apache:"
echo "     sudo cp deploy/apache.conf /etc/apache2/sites-available/transcriber.sangahub.com.conf"
echo "     sudo a2enmod proxy proxy_http headers ssl"
echo "     sudo a2ensite transcriber.sangahub.com.conf"
echo "     sudo apache2ctl configtest && sudo systemctl reload apache2"
echo "     (ensure ProxyPass port in apache.conf matches PORT in .env)"
echo "  4. Enable HTTPS:   sudo certbot --apache -d transcriber.sangahub.com"
echo
echo "See DEPLOYMENT.md for full details."
