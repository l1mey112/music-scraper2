import { drizzle } from 'drizzle-orm/bun-sqlite';
import { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import { TrackEntry, SpotifyTrack, SpotifyAlbum, Isrc, Locale, SpotifyId } from './types';
import { TrackId } from "./types";
import * as schema from './schema';
import { sql } from 'drizzle-orm';
import { deepEquals } from "bun";

const sqlite: Database = new Database('db.sqlite', { create: false, readwrite: true })

// https://phiresky.github.io/blog/2020/sqlite-performance-tuning/
sqlite.exec("pragma journal_mode = WAL;");
sqlite.exec("pragma synchronous = normal;"); // safe with WAL

export const db: BunSQLiteDatabase<typeof schema> = drizzle(sqlite, { schema })

process.on("beforeExit", (code) => {
	sqlite.close() // kill WALs and close the db, properly
});

// performs `weak_extrapolate_track`, with respect to what it actually updates
// exported as a pass here for better locality
/* export async function pass_track_meta_weak() {
	// select all tracks that have none or all nulls of certain kinds of metadata
	// metadata checked are: no spotify_id, or no isrc, or no name
	// then call `upsert_merge_track_meta` with its metadata
	// or select if a track has only nulls of the above three

	// this is decently understandable when you look at the final where clause

	const query = sql`
		SELECT t.id
		FROM ${schema.track} t
		LEFT JOIN (
			SELECT track_id,
				SUM(CASE WHEN kind NOT IN ('spotify_id', 'isrc', 'name') OR meta <> 'null' THEN 1 ELSE 0 END) AS non_null_count,
				COUNT(CASE WHEN kind IN ('spotify_id', 'isrc', 'name') THEN 1 END) AS total_count,
				COUNT(CASE WHEN kind = 'spotify_id' AND meta = 'null' THEN 1 END) AS spotify_id_null_count,
				COUNT(CASE WHEN kind = 'isrc' AND meta = 'null' THEN 1 END) AS isrc_null_count,
				COUNT(CASE WHEN kind = 'name' AND meta = 'null' THEN 1 END) AS name_null_count
			FROM ${schema.track_meta}
			GROUP BY track_id
		) tm ON t.id = tm.track_id
		WHERE (non_null_count = 0 AND (spotify_id_null_count = total_count OR isrc_null_count = total_count OR name_null_count = total_count))
		OR (non_null_count IS NULL AND total_count IS NULL);`

	const v = db.all<string>(query).map(v => parseInt(v) as TrackId)

	if (v.length == 0) {
		return false // no mutation
	}

	console.log(`pass_track_meta_weak: extrapolating ${v.length} tracks`)

	// TODO: im going to be grabbing the metadata anyway, why do that stupid fucking query above?

	for (const track_id of v) {
		// TODO: `weak_extrapolate_track` selects as well
		//       seems like a waste to double select
		const entries: TrackMeta[] = (await db.select()
			.from(schema.track_meta)
			.where(sql`${schema.track_meta.track_id} = ${track_id}`)) as TrackMetaEntry[] satisfies TrackMeta[]

		weak_extrapolate_track(entries)
		await upsert_merge_track_meta(track_id, entries)
	}

	return true // mutation
} */
