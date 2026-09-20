#!/usr/bin/env bash
# Makes `pnpm verify` runnable in a fresh cloud session: Postgres up, schema applied.
# Silent on success; never fails the session.
set -u

if command -v pg_isready >/dev/null 2>&1 && ! pg_isready -q 2>/dev/null; then
  pg_ctlcluster 16 main start >/dev/null 2>&1 || true
fi

if command -v psql >/dev/null 2>&1; then
  su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='reqforge'\"" 2>/dev/null | grep -q 1 \
    || su postgres -c "psql -c \"CREATE USER reqforge WITH PASSWORD 'reqforge' SUPERUSER;\"" >/dev/null 2>&1 || true
  su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='reqforge'\"" 2>/dev/null | grep -q 1 \
    || su postgres -c "createdb -O reqforge reqforge" >/dev/null 2>&1 || true
fi

[ -f .env ] || cp .env.example .env 2>/dev/null || true
exit 0
