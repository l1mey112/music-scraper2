import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import type { TrackEntry, TrackMetaEntry, TrackId } from './schema';
import * as schema from './schema';

// stop polluting my namespace
// spotify v1 api
import type { Track, AudioFeatures, Album } from "@spotify/web-api-ts-sdk";
import { sql } from 'drizzle-orm';

class DB {
	sqlite: Database
	schema: BunSQLiteDatabase<typeof schema>

	constructor() {
		this.sqlite = new Database('db.sqlite')
		this.schema = drizzle(this.sqlite, { schema })

		// https://phiresky.github.io/blog/2020/sqlite-performance-tuning/
		this.sqlite.exec("pragma journal_mode = WAL;");
		this.sqlite.exec("pragma synchronous = normal;"); // safe with WAL
	}

	async extrapolate_spotify_v1_get_track(track: Track): Promise<TrackId | undefined> {
		// identifying information
		// 1. isrc

		// remember, the spotify id isn't reliable for identifying tracks
		// for many good reasons

		// rare to be null
		if (track.external_ids?.isrc) {
			const k1 = await this.schema.select({ id: schema.track.id })
				.from(schema.track)
				.where(sql`${schema.track.meta_isrc} = ${track.external_ids.isrc}`)

			if (k1.length != 0) {
				return k1[0].id
			}
		}

		return undefined
	}

	async upsert_meta_spotify_v1_get_track(track_id: TrackId, track: Track, utc_millis: number) {
		const meta: TrackMetaEntry = {
			track_id: track_id,
			kind: 'spotify_v1_get_track',
			utc: utc_millis,
			meta: track,
		}

		// this'll probably work
		await this.schema.insert(schema.track_meta)
			.values(meta)
			.onConflictDoUpdate({ target: [schema.track_meta.track_id, schema.track_meta.kind], set: meta })
	}

	async append_spotify_v1_get_track(tracks: Track[], utc_millis: number) {
		// find existing meta entries with spotify id

		for (const v of tracks) {
			let track_id = await this.extrapolate_spotify_v1_get_track(v)

			if (track_id === undefined) {
				// construct a new track entry

				const isrc = v.external_ids?.isrc ? v.external_ids?.isrc : null

				if (!isrc) {
					// spotify are assholes and it's possible any of these can be null
					// but it's incredibly rare (100 in 1 000 000 tracks, trust me ive scraped a lot of data)
					console.error(`append_spotify_v1_get_track: warn no isrc for track ${v.name} (id: ${v.id})`)
				}

				const k: TrackEntry = {
					name: v.name,
					name_locale: {},

					utc: utc_millis,

					meta_isrc: isrc, 
				}

				// insert the track
				const r = await this.schema.insert(schema.track)
					.values(k)
					.returning({ id: schema.track.id })
				
				track_id = r[0].id
			}

			await this.upsert_meta_spotify_v1_get_track(track_id, v, utc_millis)
		}
	}
}

export const db = new DB();

process.on("beforeExit", (code) => {
	db.sqlite.close() // kill WALs and close the db, properly
});
