import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import type { TrackEntry, TrackMetaEntry, TrackId, TrackMetaSource, TrackMetaImpl } from './schema';
import * as schema from './schema';

// stop polluting my namespace
// spotify v1 api
import type { Track, AudioFeatures, Album } from "@spotify/web-api-ts-sdk";
import { sql } from 'drizzle-orm';

class DB {
	sqlite: Database
	schema: BunSQLiteDatabase<typeof schema>

	constructor() {
		this.sqlite = new Database('db.sqlite', { create: false, readwrite: true })
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

	async upsert_track_meta<T extends TrackMetaSource>(track_id: TrackId, source: T, meta: TrackMetaImpl[T], utc_millis: number) {
		const meta_entry: TrackMetaEntry = {
			track_id: track_id,
			kind: source,
			utc: utc_millis,
			meta: meta,
		}

		await this.upsert_track_metas([meta_entry])
	}

	async upsert_track_metas(entries: TrackMetaEntry[]) {
		// this'll probably work

		// TODO: though annoying that you can't update the whole thing in one go
		//       probably could autogenerate this tbh using Object.keys
		await this.schema.insert(schema.track_meta)
			.values(entries)
			.onConflictDoUpdate({ target: [schema.track_meta.track_id, schema.track_meta.kind], set: {
				utc: sql`excluded.utc`,
				track_id: sql`excluded.track_id`,
				kind: sql`excluded.kind`,
				meta: sql`excluded.meta`
			}})
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
					meta_spotify_id: v.id,
				}

				// insert the track
				const r = await this.schema.insert(schema.track)
					.values(k)
					.returning({ id: schema.track.id })
				
				track_id = r[0].id
			}

			await this.upsert_track_meta(track_id, 'spotify_v1_get_track', v, utc_millis)
		}
	}
}

export const db = new DB();

process.on("beforeExit", (code) => {
	db.sqlite.close() // kill WALs and close the db, properly
});
