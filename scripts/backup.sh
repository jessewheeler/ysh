#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
BACKUP_DIR="$ROOT/backups"

# Load .env if DATABASE_URL isn't already set
if [[ -z "${DATABASE_URL:-}" && -f "$ROOT/.env" ]]; then
    set -a; source "$ROOT/.env"; set +a
fi

mkdir -p "$BACKUP_DIR"

if [[ -n "${DATABASE_URL:-}" ]]; then
    if ! command -v pg_dump &>/dev/null; then
        echo "Error: pg_dump not found. Install it with:" >&2
        echo "  brew install libpq && brew link --force libpq" >&2
        exit 1
    fi
    OUT="$BACKUP_DIR/$(date +%Y%m%d-%H%M%S)-pg.dump"
    echo "Backing up PostgreSQL → $OUT"
    pg_dump "$DATABASE_URL" -F c -f "$OUT"
    echo "Done. Restore with:"
    echo "  pg_restore -d \$DATABASE_URL $OUT"
else
    DB_PATH="${DATABASE_PATH:-$ROOT/data/ysh.db}"
    if [[ ! -f "$DB_PATH" ]]; then
        echo "No database found (DATABASE_URL not set, $DB_PATH does not exist)" >&2
        exit 1
    fi
    OUT="$BACKUP_DIR/$(date +%Y%m%d-%H%M%S)-sqlite.db"
    echo "Backing up SQLite → $OUT"
    cp "$DB_PATH" "$OUT"
    echo "Done."
fi

# Prune dumps older than 30 days
find "$BACKUP_DIR" -name "*.dump" -o -name "*-sqlite.db" | while read -r f; do
    if [[ $(find "$f" -mtime +30 2>/dev/null) ]]; then
        echo "Pruning old backup: $f"
        rm "$f"
    fi
done
