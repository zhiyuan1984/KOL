#!/usr/bin/env bash
# Historical one-way cutover is retired. The authority is already PostgreSQL;
# never recreate database users, overwrite credentials, reopen a SQLite file,
# or restart a legacy engine through this entry point.
set -euo pipefail
printf '%s\n' 'SQLite cutover entry is retired. Use the PostgreSQL-native schema/app release procedure with a verified immutable revision; existing DATABASE_URL and PostgreSQL facts must be preserved.' >&2
exit 64
