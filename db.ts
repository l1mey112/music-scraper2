import { drizzle } from 'drizzle-orm/bun-sqlite'
import { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { Database } from 'bun:sqlite'
import { TrackEntry, SpotifyTrack, SpotifyAlbum, Isrc, Locale, SpotifyId } from './types'
import { TrackId } from "./types"
import * as schema from './schema'
import { sql } from 'drizzle-orm'
import { deepEquals } from "bun"

const sqlite: Database = new Database('db.sqlite', { create: false, readwrite: true })

// https://phiresky.github.io/blog/2020/sqlite-performance-tuning/
sqlite.exec("pragma journal_mode = WAL;")
sqlite.exec("pragma synchronous = normal;") // safe with WAL

export const db: BunSQLiteDatabase<typeof schema> = drizzle(sqlite, { schema })

process.on("beforeExit", (code) => {
	sqlite.exec("pragma wal_checkpoint(TRUNCATE);") // checkpoint WAL
	sqlite.exec("pragma journal_mode = DELETE;") // delete wal
	sqlite.exec("pragma vacuum;") // vacuum
	sqlite.exec("pragma optimize;") // optimize
	sqlite.close() // close the db
})
