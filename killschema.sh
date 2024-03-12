#!/bin/sh

rm -r migrations
rm db.sqlite db.sqlite-shm db.sqlite-wal

bun run drizzle-kit generate:sqlite
sqlite3 db.sqlite < `ls -aht migrations/*.sql | head -1`