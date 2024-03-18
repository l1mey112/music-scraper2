import { sql } from "drizzle-orm";
import { db } from "./db"
import { SpotifyTrack, AlbumEntry, SpotifyAlbum, TrackId, SpotifyAudioFeatures, SpotifyId, AlbumId, ArtistId, TrackEntry, ArtistEntry, Isrc, QobuzId, QobuzTrack } from './types';
import * as schema from './schema';
import { spotify_api } from "./spotify";
import { safepoint } from "./safepoint";
import { qobuz_api } from "./qobuz";

// register backoff for a pass if it failed and would be expensive to compute again

// for now just make it never retry
const retry_backoff_after_millis = 1000 * 60 * 60 * 24 * 365 * 1000 // 1000 years
const retry_cutoff = Date.now() - retry_backoff_after_millis

function register_backoff_track(id: TrackId, pass_name: string) {
	console.log(`register_backoff_track: registering backoff for track ${id} for pass ${pass_name}`)

	db.insert(schema.pass_backoff)
		.values({ track_id: id, utc: Date.now(), pass: pass_name })
		.run()
}

function register_backoff_album(id: AlbumId, pass_name: string) {
	db.insert(schema.pass_backoff)
		.values({ album_id: id, utc: Date.now(), pass: pass_name })
		.run()
}

function register_backoff_artist(id: ArtistId, pass_name: string) {
	db.insert(schema.pass_backoff)
		.values({ artist_id: id, utc: Date.now(), pass: pass_name })
		.run()
}

async function run_with_concurrency_limit<T>(arr: T[], concurrency_limit: number, next: (v: T) => Promise<void>): Promise<void> {
	const active_promises: Promise<void>[] = [];

	for (const item of arr) {
		// Wait until there's room for a new operation
		while (active_promises.length >= concurrency_limit) {
			await Promise.race(active_promises);
		}

		const next_operation = next(item);
		active_promises.push(next_operation);

		next_operation.finally(() => {
			const index = active_promises.indexOf(next_operation);
			if (index !== -1) {
				active_promises.splice(index, 1);
			}
		});
	}

	// Wait for all active operations to complete
	await Promise.all(active_promises);
}

// this can rarely fail, don't do backoff
// it's not like we're looking up a track by name
async function pass_track_meta_spotify_v1_audio_features() {
	// 1. tracks with a spotify id
	// 2. tracks without audio features
	// 3. tracks that don't have a backoff for this pass
	// TODO: create a prepared statement builder for this
	const k = db.select({ id: schema.track.id, meta_spotify_id: schema.track.meta_spotify_id })
		.from(schema.track)
		.where(sql`meta_spotify_id is not null and meta_spotify_v1_audio_features is null and id not in (
			select track_id from pass_backoff where pass = 'track.meta.spotify_v1_audio_features'
			and utc > ${retry_cutoff}
		)`)
		.all()

	let offset = 0

	while (offset < k.length) {
		const sp = safepoint('pass.track.meta.spotify_v1_audio_features.batch100')
		const noffset = offset + 100 // 100 is the maximum batch size
		const batch = k.slice(offset, noffset)
		const ids = batch.map(v => v.meta_spotify_id!) // definitely not null

		// these can be null they are a liar
		const features: (SpotifyAudioFeatures | null)[] = await spotify_api.tracks.audioFeatures(ids)

		let feature_idx = 0
		for (const feature of features) {
			if (!feature) {
				register_backoff_track(batch[feature_idx].id, 'track.meta.spotify_v1_audio_features')
				continue
			}

			db.update(schema.track)
				.set({ meta_spotify_v1_audio_features: feature })
				.where(sql`meta_spotify_id = ${feature.id}`)
				.run()
			
			feature_idx++
		}

		sp.release()
		offset = noffset
	}

	return k.length > 0 // mutation
}

async function pass_track_meta_spotify_v1_get_track() {
	const k = db.select({ id: schema.track.id, meta_spotify_id: schema.track.meta_spotify_id })
		.from(schema.track)
		.where(sql`meta_spotify_id is not null and meta_spotify_v1_get_track is null and id not in (
			select track_id from pass_backoff where pass = 'track.meta.spotify_v1_get_track'
			and utc > ${retry_cutoff}
		)`)
		.all()
	
	let offset = 0

	// > A comma-separated list of the Spotify IDs. For example: ...
	// > Maximum: 100 IDs.

	// they lied here, it's 50

	while (offset < k.length) {
		const sp = safepoint('pass.track.meta.spotify_v1_get_track.batch100')
		const noffset = offset + 50 // 50 is the maximum batch size
		const batch = k.slice(offset, noffset)
		const ids = batch.map(v => v.meta_spotify_id!) // definitely not null
		const tracks = await spotify_api.tracks.get(ids)

		for (const track of tracks) {
			db.update(schema.track)
				.set({ meta_spotify_v1_get_track: track })
				.where(sql`meta_spotify_id = ${track.id}`)
				.run()
		}

		sp.release()
		offset = noffset
	}

	return k.length > 0 // mutation
}

// creates `spotify_v1_get_album` metadata
async function pass_album_spotify_track_extrapolate() {
	// select all tracks with a spotify_v1_get_track and no album id
	// assume that if spotify_v1_get_track is present, then the spotify id is present too
	const k0 = db.select({ id: schema.track.id, meta_spotify_v1_get_track: schema.track.meta_spotify_v1_get_track })
		.from(schema.track)
		.where(sql`meta_spotify_v1_get_track is not null and album_id is null and id not in (
			select track_id from pass_backoff where pass = 'album.spotify_track_extrapolate'
			and utc > ${retry_cutoff}
		)`)
		.all()
	
	// given a list of spotify track ids, get the album ids

	// prune into a set
	// TODO: spotify_v1_get_track stores more information than needed tbh
	// TODO: should remove unneeded stuff most of the album information
	const albums = new Set(k0.map(v => v.meta_spotify_v1_get_track!.album.id))

	// remove albums that already have a spotify id

	const k1 = db.select({ meta_spotify_id: schema.album.meta_spotify_id })
		.from(schema.album)
		.where(sql`meta_spotify_id is not null`)
		.all()
	
	for (const v of k1) {
		albums.delete(v.meta_spotify_id!)
	}

	let offset = 0
	const album_spotify_ids = Array.from(albums)

	if (album_spotify_ids.length === 0) {
		return false // no mutation
	}

	while (offset < album_spotify_ids.length) {
		const sp = safepoint('pass.album.spotify_track_extrapolate.batch20')
		const noffset = offset + 20
		const batch = album_spotify_ids.slice(offset, noffset)
		const albums = await spotify_api.albums.get(batch)

		for (const album of albums) {
			// @ts-ignore
			delete album.tracks // just fucking let me

			// spotify albums never have an ISRC, never. they don't have it
			if (album.external_ids?.isrc) {
				console.error(`pass.album.spotify_track_extrapolate: warn album ${album.name} (id: ${album.id}) has an ISRC (how lucky?)`)
			}

			const entry: AlbumEntry = {
				name: album.name,

				meta_spotify_id: album.id,
				meta_spotify_v1_get_album: album,
			}

			db.insert(schema.album)
				.values(entry)
				.run()
		}

		sp.release()
		offset = noffset
	}

	return true // mutation
}

// rare, but inserted for completeness
async function pass_album_meta_spotify_v1_get_album() {
	const k = db.select({ id: schema.album.id, meta_spotify_id: schema.album.meta_spotify_id })
		.from(schema.album)
		.where(sql`meta_spotify_id is not null and meta_spotify_v1_get_album is null and id not in (
			select album_id from pass_backoff where pass = 'album.meta.spotify_v1_get_album'
			and utc > ${retry_cutoff}
		)`)
		.all()
	
	let offset = 0

	while (offset < k.length) {
		const sp = safepoint('pass.album.meta.spotify_v1_get_album.batch20')
		const noffset = offset + 20 // 20 is the maximum batch size
		const batch = k.slice(offset, noffset)
		const ids = batch.map(v => v.meta_spotify_id!) // definitely not null
		const albums = await spotify_api.albums.get(ids)

		for (const album of albums) {
			db.update(schema.album)
				.set({ meta_spotify_v1_get_album: album })
				.where(sql`meta_spotify_id = ${album.id}`)
				.run()
		}

		sp.release()
		offset = noffset
	}

	return k.length > 0 // mutation
}

// doesn't depend on `spotify_v1_get_album`
// creates new tracks without any metadata other than spotify id
async function pass_track_spotify_album_extrapolate() {
	// select all albums with null total tracks and a spotify id

	const k = db.select({ id: schema.album.id, meta_spotify_id: schema.album.meta_spotify_id })
		.from(schema.album)
		.where(sql`meta_spotify_id is not null and total_tracks is null and id not in (
			select album_id from pass_backoff where pass = 'track.spotify_album_extrapolate'
			and utc > ${retry_cutoff}
		)`)
		.all()
	
	if (k.length === 0) {
		return false // no mutation
	}
	
	// for every single album, get the tracks

	for (const db_album of k) {
		const sp = safepoint('pass.track.spotify_album_extrapolate')
		
		// find all tracks
		let offset = 0
		const album_tracks = []

		let total

		do {
			const req = await spotify_api.albums.tracks(db_album.meta_spotify_id!, undefined, 50, offset)
			if (!total) {
				total = req.total
			}
			album_tracks.push(...req.items)
			offset += 50
		} while (album_tracks.length < total)

		// copied logic from `thirdparty_spotify_index_liked`

		// update tracks
		// insert new tracks if they don't exist
		for (const track of album_tracks) {
			const spotify_id = track.id

			const k0 = db.select({ id: schema.track.id })
				.from(schema.track)
				.where(sql`meta_spotify_id = ${spotify_id}`)
				.limit(1)
				.all()
			
			const track_id: TrackId | undefined = k0[0]?.id

			if (!track_id) {
				// insert track
				const entry: TrackEntry = {
					name: track.name,

					meta_spotify_id: spotify_id,

					album_id: db_album.id,
					album_track_number: track.track_number,
					album_disc_number: track.disc_number,
				}

				const k1 = db.insert(schema.track)
					.values(entry)
					.returning({ id: schema.track.id })
					.all()
			} else {
				// update track

				db.update(schema.track)
					.set({
						album_id: db_album.id,
						album_track_number: track.track_number,
						album_disc_number: track.disc_number,
					})
					.where(sql`meta_spotify_id = ${spotify_id}`)
					.run()
			}
		}

		// set total tracks, and close the loop
		db.update(schema.album)
			.set({ total_tracks: total })
			.where(sql`id = ${db_album.id}`)
			.run()

		sp.release()
	}

	return true // mutation
}

function pass_artist_spotify_track_extrapolate() {
	// select all tracks with a spotify_v1_get_album and no artists on track_artists
	// query track_artists which is a mapping of track_id to artist_id
	// if count of artists on track_id is 0, then we need to get the artists from the album

	const k = db.select({ id: schema.track.id, meta_spotify_v1_get_track: schema.track.meta_spotify_v1_get_track })
		.from(schema.track)
		.where(sql`meta_spotify_v1_get_track is not null and not exists (
			select 1 from track_artists where track_id = track.id
		) and id not in (
			select track_id from pass_backoff where pass = 'artist.spotify_track_extrapolate'
			and utc > ${retry_cutoff}
		)`)
		.all()

	if (k.length === 0) {
		return false // no mutation
	}

	for (const db_track of k) {
		const sp = safepoint('pass.artist.spotify_track_extrapolate')

		const album = db_track.meta_spotify_v1_get_track!.album
		const artists = album.artists

		let idx = 0
		for (const artist of artists) {
			const k0 = db.select({ id: schema.artist.id })
				.from(schema.artist)
				.where(sql`meta_spotify_id = ${artist.id}`)
				.limit(1)
				.all()

			let artist_id: ArtistId | undefined = k0[0]?.id
			
			if (!artist_id) {
				// create artist

				const entry: ArtistEntry = {
					name: artist.name,
					meta_spotify_id: artist.id,
				}

				const k1 = db.insert(schema.artist)
					.values(entry)
					.returning({ id: schema.artist.id })
					.all()

				artist_id = k1[0].id
			}

			// create track_id and artist_id pair
			db.insert(schema.track_artists)
				.values({ track_id: db_track.id, artist_id: artist_id, is_first: idx == 0 })
				.onConflictDoNothing()
				.run()
			idx++
		}

		sp.release()
	}

	return true // mutation
}

async function pass_artist_meta_spotify_v1_get_artist() {
	const k = db.select({ id: schema.artist.id, meta_spotify_id: schema.artist.meta_spotify_id })
		.from(schema.artist)
		.where(sql`meta_spotify_id is not null and meta_spotify_v1_get_artist is null and id not in (
			select artist_id from pass_backoff where pass = 'artist.meta.spotify_v1_get_artist'
			and utc > ${retry_cutoff}
		)`)
		.all()
	
	let offset = 0

	// > A comma-separated list of the Spotify IDs. For example: ...
	// > Maximum: 100 IDs.

	// they lied here AGAIN, it's 50

	while (offset < k.length) {
		const sp = safepoint('pass.artist.meta.spotify_v1_get_artist.batch50')
		const noffset = offset + 50 // 50 is the maximum batch size
		const batch = k.slice(offset, noffset)
		const ids = batch.map(v => v.meta_spotify_id!) // definitely not null
		const artists = await spotify_api.artists.get(ids)

		for (const artist of artists) {
			db.update(schema.artist)
				.set({ meta_spotify_v1_get_artist: artist })
				.where(sql`meta_spotify_id = ${artist.id}`)
				.run()
		}

		sp.release()
		offset = noffset
	}

	return k.length > 0 // mutation
}

// search using "{title} {artist}"
async function pass_track_meta_search_qobuz() {
	const sql_query = sql`
	SELECT
		t.id AS id,
		t.meta_isrc as isrc,
		t.name AS track_name,
		first_artist.name AS artist_name
	FROM
		track t
	INNER JOIN (
		SELECT ta.track_id, a.name
		FROM track_artists ta
		INNER JOIN artist a ON ta.artist_id = a.id
		WHERE ta.is_first AND a.name IS NOT NULL
	) first_artist ON t.id = first_artist.track_id
	WHERE first_artist.name IS NOT NULL AND t.meta_qobuz_id IS NULL AND t.meta_isrc IS NOT NULL
		AND t.id NOT IN (
			SELECT track_id
			FROM pass_backoff
			WHERE pass = 'track.meta.search_qobuz'
			AND utc > ${retry_cutoff}
		);`
	
	const k = db.all<{ id: TrackId, isrc: Isrc, track_name: string, artist_name: string }>(sql_query)

	type QobuzSearchItem = {
		isrc: Isrc
		id: QobuzId
	}

	type QobuzSearch = {
		tracks: {
			total: number
			items: QobuzSearchItem[]			
		}
	}

	for (const track of k) {
		const sp = safepoint('pass.track.meta.search_qobuz')

		const search = `${track.track_name} ${track.artist_name}`

		// default limit is 50
		// if we don't find what we're looking for within 50 tracks, then we're not going to find it
		const k = await qobuz_api(`track/search?query=${encodeURIComponent(search)}`)
		if (!k.ok) {
			console.error(`pass_track_meta_qobuz: request status non 200: ${k.status} ${await k.text()}`)
			process.exit(1)
		}
		const j: QobuzSearch = await k.json() as any

		let found = false

		// match isrc
		for (const item of j.tracks.items) {
			if (item.isrc === track.isrc) {
				found = true

				db.update(schema.track)
					.set({ meta_qobuz_id: item.id })
					.where(sql`id = ${track.id}`)
					.run()
				break
			}
		}

		if (!found) {
			register_backoff_track(track.id, 'track.meta.search_qobuz')
		}
		sp.release()
	}

	return k.length > 0 // mutation
}

async function pass_track_meta_qobuz_track_get() {
	const k = db.select({ id: schema.track.id, meta_qobuz_id: schema.track.meta_qobuz_id })
		.from(schema.track)
		.where(sql`meta_qobuz_id is not null and meta_qobuz_get_track is null`)
		.all()

	for (const track of k) {
		const sp = safepoint('pass.track.meta.qobuz_track_get')

		const k = await qobuz_api(`track/get?track_id=${track.meta_qobuz_id!}`)
		if (!k.ok) {
			console.error(`pass_track_meta_qobuz: request status non 200: ${k.status} ${await k.text()}`)
			process.exit(1)
		}
		const j: QobuzTrack = await k.json() as any

		db.update(schema.track)
			.set({ meta_qobuz_get_track: j })
			.where(sql`id = ${track.id}`)
			.run()

		sp.release()
	}

	return k.length > 0 // mutation
}

// extract spotify ids, isrcs, qobuz ids, and so on
// weak meaning no network touching
// won't check for these things:
// - `spotify_v1_get_track` + `spotify_v1_audio_features` implies `spotify_id`
function pass_track_meta_weak() {
	// isrc from spotify_v1_get_track

	const k = db.select({ id: schema.track.id, meta_spotify_v1_get_track: schema.track.meta_spotify_v1_get_track })
		.from(schema.track)
		.where(sql`meta_spotify_v1_get_track is not null and meta_isrc is null`)
		.all()
	
	for (const track of k) {
		const isrc = track.meta_spotify_v1_get_track!.external_ids?.isrc
		if (isrc) {
			db.update(schema.track)
				.set({ meta_isrc: isrc })
				.where(sql`id = ${track.id}`)
				.run()
		} else {
			// shouldn't happen really
			// if it keeps happening insert a backoff
			// though if we were to insert a backoff having a more fine grained pass would be much better
			console.error(`pass_track_meta_weak: warn track ${track.id} has no ISRC`)
		}
	}

	return k.length > 0 // mutation
}

export enum PassFlags {
	none = 0,
	spotify = 1 << 0,
	spotify_user = 1 << 1,
	qobuz_user = 1 << 2,
}

export function passflags_string(flags: number & PassFlags) {
	const ret = []

	for (const [k, v] of Object.entries(PassFlags)) {
		if (flags & v as PassFlags) {
			ret.push(k)
		}
	}

	if (ret.length === 0) {
		ret.push('none')
	}

	return ret.join(' | ')
}

export type PassBlock = {
	name: string
	fn: () => boolean | Promise<boolean>
	flags: number & PassFlags
}

// don't you just love phase ordering?
export const passes: PassBlock[] = [
	{ name: 'track.meta.weak', fn: pass_track_meta_weak, flags: PassFlags.none },
	// { name: 'track.meta.search_ident', fn: pass_track_meta_search_ident, flags: PassFlags.spotify },
	{ name: 'track.spotify_album_extrapolate', fn: pass_track_spotify_album_extrapolate, flags: PassFlags.spotify },
	{ name: 'track.meta.spotify_v1_get_track', fn: pass_track_meta_spotify_v1_get_track, flags: PassFlags.spotify },
	{ name: 'track.meta.spotify_v1_audio_features', fn: pass_track_meta_spotify_v1_audio_features, flags: PassFlags.spotify },
	{ name: 'track.meta.search_qobuz', fn: pass_track_meta_search_qobuz, flags: PassFlags.qobuz_user },
	{ name: 'track.meta.qobuz_track_get', fn: pass_track_meta_qobuz_track_get, flags: PassFlags.qobuz_user },
	{ name: 'album.spotify_track_extrapolate', fn: pass_album_spotify_track_extrapolate, flags: PassFlags.spotify },
	{ name: 'album.meta.spotify_v1_get_album', fn: pass_album_meta_spotify_v1_get_album, flags: PassFlags.spotify },
	{ name: 'artist.spotify_track_extrapolate', fn: pass_artist_spotify_track_extrapolate, flags: PassFlags.none },
	{ name: 'artist.meta.spotify_v1_get_artist', fn: pass_artist_meta_spotify_v1_get_artist, flags: PassFlags.spotify },
]
