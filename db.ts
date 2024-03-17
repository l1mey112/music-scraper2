import { drizzle } from 'drizzle-orm/bun-sqlite';
import { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import { TrackEntry, TrackMetaEntry, SpotifyTrack, SpotifyAlbum, AlbumMetaEntry, AlbumEntry, AlbumMetaImpl, Isrc, Locale, SpotifyId, TrackMeta } from './types';
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
export async function pass_track_meta_weak() {
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
}

// extrapolate the low hanging fruit without touching the network
function weak_extrapolate_track(entries: TrackMeta[]) {
	const existing_isrc = new Set<Isrc>();
	const existing_spotify_id = new Set<SpotifyId>();

	// i hate reference equality
	const existing_name = new Set<string>(); // JSON stringified Locale

	// ensure predictable order and fields
	function nlocale(locale: Locale) {
		if (!locale.locale) {
			locale.locale = undefined;
		}
		return JSON.stringify({ name: locale.name, locale: locale.locale });
	}

	for (const entry of entries) {
		if (entry.kind === 'isrc' && entry.meta) {
			existing_isrc.add(entry.meta);
		} else if (entry.kind === 'spotify_id' && entry.meta) {
			existing_spotify_id.add(entry.meta);
		} else if (entry.kind === 'name' && entry.meta) {
			existing_name.add(nlocale(entry.meta));
		}
	}

	for (const entry of entries) {
		if (entry.meta) switch (entry.kind) {
			case 'spotify_v1_get_track': {
				const isrc = entry.meta.external_ids?.isrc;
				if (isrc && !existing_isrc.has(isrc)) {
					entries.push({
						kind: 'isrc',
						meta: isrc,
						utc: entry.utc,
					});
					existing_isrc.add(isrc);
				}
				const spotify_id = entry.meta.id;
				if (spotify_id && !existing_spotify_id.has(spotify_id)) {
					entries.push({
						kind: 'spotify_id',
						meta: spotify_id,
						utc: entry.utc,
					});
					existing_spotify_id.add(spotify_id);
				}
				const name = nlocale({ name: entry.meta.name });
				if (!existing_name.has(name)) {
					entries.push({
						kind: 'name',
						meta: { name: entry.meta.name },
						utc: entry.utc,
					});
					existing_name.add(name);
				}
				break;
			}

			case 'spotify_v1_audio_features': {
				const spotify_id = entry.meta.id;
				if (spotify_id && !existing_spotify_id.has(spotify_id)) {
					entries.push({
						kind: 'spotify_id',
						meta: spotify_id,
						utc: entry.utc,
					});
					existing_spotify_id.add(spotify_id);
				}
				break;
			}

			case 'name':
			case 'isrc':
			case 'spotify_id':
				break;

			default: {
				// ts doesn't like defensive programming, cast away from `never`
				// field access (or anything) on a `never` type should just produce more `never`, but whatever
				const kind = (entry as TrackMeta).kind;
				console.error(`weak_extrapolate_track: warn unimplemented kind ${kind}`);
				break;
			}
		}
	}
}


// match an existing track based on the metadata
async function match_track(entries: TrackMeta[]): Promise<TrackId | undefined> {
	const existing_isrc = new Set<Isrc>()
	const existing_spotify_id = new Set<SpotifyId>()

	for (const entry of entries) {
		if (entry.kind === 'isrc' && entry.meta) {
			existing_isrc.add(entry.meta)
		} else if (entry.kind === 'spotify_id' && entry.meta) {
			existing_spotify_id.add(entry.meta)
		}
	}

	const k0 = await db.select({ track_id: schema.track_meta.track_id })
		.from(schema.track_meta)
		.where(sql`${schema.track_meta.kind} = 'isrc' and ${schema.track_meta.meta} in ${Array.from(existing_isrc)}`)

	if (k0.length > 0) {
		console.error(`match_track: warn multiple tracks with the same ISRC (ids: ${k0.map(x => x.track_id).join(', ')})`)
	}

	if (k0.length != 0) {
		return k0[0].track_id
	}

	const k1 = await db.select({ track_id: schema.track_meta.track_id })
		.from(schema.track_meta)
		.where(sql`${schema.track_meta.kind} = 'spotify_id' and ${schema.track_meta.meta} in ${Array.from(existing_spotify_id)}`)

	// multiple tracks can have the same spotify id, but they must have the same ISRC

	if (k1.length != 0) {
		return k1[0].track_id
	}

	return undefined
}

async function upsert_merge_track_meta(track: TrackId, entires: TrackMeta[]) {
	// grab all and perform a diff

	const existing = (await db.select()
		.from(schema.track_meta)
		.where(sql`${schema.track_meta.track_id} = ${track}`)) as TrackMetaEntry[]

	// look at comments on TrackMetaImpl for each kind
	// that outlines the rules for merging

	// all modes of touching the database go through here
	// that means the data will be in a consistent state
	// assume everything in existing respects those above rules

	const to_append: TrackMetaEntry[] = []

	// this is O(n^2) but n is small
	for (const entry of entires) {
		// metadata is idempotent, deepEquals is fine
		const i = existing.findIndex(x => x.kind === entry.kind && deepEquals(x.meta, entry.meta))

		// found, keep oldest
		if (i !== -1) {
			continue
		}

		// replace a null entry
		const j = existing.findIndex(x => x.kind === entry.kind && x.meta === null)

		if (j !== -1) {
			await db.update(schema.track_meta)
				.set({ meta: entry.meta, utc: entry.utc })
				.where(sql`${schema.track_meta.id} = ${existing[j].id}`)

			continue
		}

		// special cases
		switch (entry.kind) {
			case 'name': {
				// 1 of each "locale" kind
				const i = existing.findIndex(x => x.kind === 'name' && x.meta.locale === entry.meta.locale)

				if (i !== -1) {
					// prefer older
					continue
				}
				break
			}

			case 'isrc': {
				// 1
				const i = existing.findIndex(x => x.kind === 'isrc')

				if (i !== -1) {
					// prefer older
					if (entry.meta !== existing[i].meta) {
						console.error(`upsert_merge_track_meta: warn ISRC mismatch ignored (new: ${entry.meta}, old: ${existing[i].meta}, id: ${track}, meta_id: ${existing[i].id})`)
					}
					continue
				}
				break
			}
		}

		// create new entry
		to_append.push({
			track_id: track,
			...entry,
		})
	}

	if (to_append.length !== 0) {
		await db.insert(schema.track_meta)
			.values(to_append)
	}
}

export async function upsert_intern_and_extrapolate_track(entries: TrackMeta[]): Promise<TrackId> {
	weak_extrapolate_track(entries)
	let track_id = await match_track(entries)

	if (track_id) {
		upsert_merge_track_meta(track_id, entries)
	} else {
		const track_entry: TrackEntry = {}
		
		// create new track
		const k = await db.insert(schema.track)
			.values(track_entry)
			.returning({ id: schema.track.id })
		track_id = k[0].id

		// create new track meta
		const meta_entries = entries.map((v): TrackMetaEntry => {
			return {
				track_id: track_id!, // closure into map is a side effect?? wtf typescript i know this isn't undefined
				...v,
			}
		})

		await db.insert(schema.track_meta)
			.values(meta_entries)
	}

	return track_id
}