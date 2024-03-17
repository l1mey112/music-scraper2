import { sql } from "drizzle-orm";
import { db } from "./db"
import { SpotifyTrack, AlbumEntry, SpotifyAlbum, TrackId, SpotifyAudioFeatures, SpotifyId, AlbumId, ArtistId, TrackEntry } from './types';
import * as schema from './schema';
import { spotify_api } from "./spotify";
import { safepoint } from "./safepoint";

// register backoff for a pass if it failed and would be expensive to compute again

// for now just make it never retry
const retry_backoff_after_millis = 1000 * 60 * 60 * 24 * 365 * 1000 // 1000 years
const retry_cutoff = Date.now() - retry_backoff_after_millis

export function register_backoff_track(id: TrackId, pass_name: string) {
	console.log(`register_backoff_track: registering backoff for track ${id} for pass ${pass_name}`)

	db.insert(schema.pass_backoff)
		.values({ track_id: id, utc: Date.now(), pass: pass_name })
		.run()
}

export function register_backoff_album(id: AlbumId, pass_name: string) {
	db.insert(schema.pass_backoff)
		.values({ album_id: id, utc: Date.now(), pass: pass_name })
		.run()
}

export function register_backoff_artist(id: ArtistId, pass_name: string) {
	db.insert(schema.pass_backoff)
		.values({ artist_id: id, utc: Date.now(), pass: pass_name })
		.run()
}

// this can rarely fail, don't do backoff
// it's not like we're looking up a track by name
export async function pass_track_meta_spotify_v1_audio_features() {
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

		for (const feature of features) {
			if (!feature) {
				register_backoff_track(k[offset].id, 'track.meta.spotify_v1_audio_features')
				continue
			}

			db.update(schema.track)
				.set({ meta_spotify_v1_audio_features: feature })
				.where(sql`meta_spotify_id = ${feature.id}`)
				.run()
		}

		sp.release()
		offset = noffset
	}

	return k.length > 0 // mutation
}

export async function pass_track_meta_spotify_v1_get_track() {
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
}

// creates `spotify_v1_get_album` metadata
export async function pass_album_spotify_extrapolate() {
	// select all tracks with a spotify_v1_get_track and no album id
	// assume that if spotify_v1_get_track is present, then the spotify id is present too
	const k0 = db.select({ id: schema.track.id, meta_spotify_v1_get_track: schema.track.meta_spotify_v1_get_track })
		.from(schema.track)
		.where(sql`meta_spotify_v1_get_track is not null and album_id is null and id not in (
			select track_id from pass_backoff where pass = 'album.spotify_extrapolate'
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
		const sp = safepoint('pass.album.spotify_extrapolate.batch20')
		const noffset = offset + 20
		const batch = album_spotify_ids.slice(offset, noffset)
		const albums = await spotify_api.albums.get(batch)

		for (const album of albums) {
			// @ts-ignore
			delete album.tracks // just fucking let me

			// spotify albums never have an ISRC, never. they don't have it
			if (album.external_ids?.isrc) {
				console.error(`pass.album.spotify_extrapolate: warn album ${album.name} (id: ${album.id}) has an ISRC (how lucky?)`)
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
export async function pass_album_meta_spotify_v1_get_album() {
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
export async function pass_track_spotify_album_extrapolate() {
	// select all albums with null total tracks and a spotify id

	const k = db.select({ id: schema.album.id, meta_spotify_id: schema.album.meta_spotify_id })
		.from(schema.album)
		.where(sql`meta_spotify_id is not null and total_tracks is null and id not in (
			select album_id from pass_backoff where pass = 'track.spotify_album_extrapolate'
			and utc > ${retry_cutoff}
		)`)
		.all()
	
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
}

export enum PassFlags {
	none = 0,
	spotify = 1 << 0,
	spotify_user = 1 << 1,
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
	fn: () => Promise<boolean>
	flags: number & PassFlags
}

// don't you just love phase ordering?
export const passes = [
	// { name: 'track.meta.weak', fn: pass_track_meta_weak, flags: PassFlags.none },
	// { name: 'track.meta.search_ident', fn: pass_track_meta_search_ident, flags: PassFlags.spotify },
	{ name: 'track.meta.spotify_v1_get_track', fn: pass_track_meta_spotify_v1_get_track, flags: PassFlags.spotify },
	{ name: 'track.meta.spotify_v1_audio_features', fn: pass_track_meta_spotify_v1_audio_features, flags: PassFlags.spotify },
	{ name: 'album.spotify_extrapolate', fn: pass_album_spotify_extrapolate, flags: PassFlags.spotify },
	{ name: 'album.meta.spotify_v1_get_album', fn: pass_album_meta_spotify_v1_get_album, flags: PassFlags.spotify },
	{ name: 'track.spotify_album_extrapolate', fn: pass_track_spotify_album_extrapolate, flags: PassFlags.spotify },
]
