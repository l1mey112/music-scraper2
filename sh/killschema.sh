#!/bin/sh

rm -r migrations
rm db.sqlite db.sqlite-shm db.sqlite-wal

bun run drizzle-kit generate:sqlite
HEAD=`ls -aht migrations/*.sql | head -1`
sh/post.py schema.ts $HEAD | sqlite3 db.sqlite