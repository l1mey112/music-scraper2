#!/bin/sh

bun run drizzle-kit generate:sqlite
sqlite3 db.sqlite < `ls -aht migrations/*.sql | head -1`