import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import type { TrackEntry, TrackMetaEntry, TrackId, TrackMetaSource, TrackMetaImpl, SpotifyTrack, SpotifyAlbum, AlbumId, AlbumMetaEntry, AlbumEntry, AlbumMetaSource, AlbumMetaImpl } from './schema';
import * as schema from './schema';
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

	async extrapolate_spotify_v1_get_track(track: SpotifyTrack): Promise<TrackId | undefined> {
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

	async extrapolate_spotify_v1_get_album(album: SpotifyAlbum): Promise<AlbumId | undefined> {
		// identifying information
		// 1. isrc

		// rare to be null
		if (album.external_ids?.isrc) {
			const k1 = await this.schema.select({ id: schema.album.id })
				.from(schema.album)
				.where(sql`${schema.album.meta_isrc} = ${album.external_ids.isrc}`)

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

	async upsert_album_meta<T extends AlbumMetaSource>(album_id: AlbumId, source: T, meta: AlbumMetaImpl[T], utc_millis: number) {
		const meta_entry: AlbumMetaEntry = {
			album_id: album_id,
			kind: source,
			utc: utc_millis,
			meta: meta,
		}

		await this.upsert_album_metas([meta_entry])
	}

	async upsert_album_metas(entries: AlbumMetaEntry[]) {
		await this.schema.insert(schema.album_meta)
			.values(entries)
			.onConflictDoUpdate({ target: [schema.album_meta.album_id, schema.album_meta.kind], set: {
				utc: sql`excluded.utc`,
				album_id: sql`excluded.album_id`,
				kind: sql`excluded.kind`,
				meta: sql`excluded.meta`
			}})
	}
}

export const db = new DB();

process.on("beforeExit", (code) => {
	db.sqlite.close() // kill WALs and close the db, properly
});
