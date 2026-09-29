---
name: verify
description: Run the YSH app against a throwaway SQLite DB and drive the admin UI in a real browser (agent-browser) to verify a change at runtime.
---

# Verify YSH in a browser

## Isolated server (never the dev or prod DB)

Write the env to a file first and check it loaded before running anything. A failed
`&&` chain that skips the env export runs scripts against `data/ysh.db`, or against
production if `.env`'s `DATABASE_URL` is ever uncommented.

```bash
# $S = session scratchpad
cat > $S/env.sh <<'EOF'
export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"   # Node 22 for better-sqlite3
export DATABASE_URL= DATABASE_PATH=$S/verify.db NODE_ENV=test PORT=3917
export MAILERSEND_API_KEY= B2_KEY_ID= B2_APPLICATION_KEY= EXPIRY_JOB_ENABLED= SCHEDULE_SYNC_ENABLED=
EOF
set -e; . $S/env.sh; test -n "$DATABASE_PATH"
node db/migrate.js
node scripts/create-admin.js verify@ysh.test super_admin Verify Admin
node server.js            # run in background
```

- zsh: `rm -f $S/verify.db*` with no match is an error (`no matches found`) and kills the
  chain. Use `rm -f "$S"/verify.db` or `setopt nonomatch`.
- `migrate.js` seeds its own membership periods (ids 1–4, including "2026 Season").
  Query `membership_periods` before seeding rows that reference a period id.
- Seed test data with `sqlite3 "$DATABASE_PATH"`.

## Log in

`NODE_ENV=test` fixes the OTP at `000000`:
`agent-browser open http://localhost:3917/admin/login` → fill email → "Send Login Code" →
fill `000000` → "Verify". Then use the sidebar links.

## Driving tips

- Read tables with `agent-browser eval 'JSON.stringify([...document.querySelectorAll("#t tbody tr")].map(...))'`.
- `find text "Past" click` misses pill links whose accessible name includes the count
  ("Past 2"). Snapshot `-s ".view-pills"` and click the ref.
- For `data-auto-submit` selects, use `agent-browser select 'select[name=…]' <value>`
  and then check the URL.
- Teardown: `agent-browser close`, then `pkill -f "node server.js"`.
