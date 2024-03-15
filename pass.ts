import { sql } from "drizzle-orm";
import { db } from "./db"
import { TrackMetaEntry, SpotifyTrack, AlbumEntry, AlbumMetaEntry, SpotifyAlbum, TrackMetaSource, TrackId } from './types';
import * as schema from './schema';
import { spotify_api } from "./spotify";
import { safepoint } from "./safepoint";

// select all tracks without audio features in meta
async function pass_track_meta_spotify_v1_audio_features() {
	// select all tracks without a single audio features in meta
	// how could you express this better in drizzle?
	/* const k = await db.schema.select({ id: schema.track.id, meta_spotify_id: schema.track.meta_spotify_id })
		.from(schema.track)
		.where(sql`${schema.track.meta_spotify_id} is not null and not exists (
			select 1
			from ${schema.track_meta}
			where ${schema.track_meta.track_id} = ${schema.track.id} and ${schema.track_meta.kind} = 'spotify_v1_audio_features'
		)`)

	// batch all requests in size of 100

	let offset = 0

	while (offset < k.length) {
		const sp = safepoint('spotify.index_liked_songs.batch50')
		const noffset = offset + 100
		const batch = k.slice(offset, noffset)
		const ids = batch.map(v => v.meta_spotify_id!) // definitely not null
		const utc = Date.now()
		const features = await spotify_api.tracks.audioFeatures(ids)

		// assume that they're all in order, ive tested a couple of times

		// console.log(`pass_meta_spotify_v1_audio_features: batch ${offset} to ${noffset} (slice: ${ids.length}, total: ${k.length})`)

		const entries: TrackMetaEntry[] = features.map((v, i) => {
			return {
				track_id: batch[i].id,
				kind: 'spotify_v1_audio_features',
				utc: utc,
				meta: v,
			}
		})

		await db.upsert_track_metas(entries)
		sp.release()

		offset = noffset
	}

	return k.length > 0 */ // mutation
	return false
}

// select all tracks without track meta
async function pass_track_meta_spotify_v1_get_track() {
	/* const k = await db.schema.select({ id: schema.track.id, meta_spotify_id: schema.track.meta_spotify_id })
		.from(schema.track)
		.where(sql`${schema.track.meta_spotify_id} is not null and not exists (
			select 1
			from ${schema.track_meta}
			where ${schema.track_meta.track_id} = ${schema.track.id} and ${schema.track_meta.kind} = 'spotify_v1_get_track'
		)`)

	// use spotify search feature to look for isrc

	for (const v of k) {
		console.log(`pass_track_meta_spotify_v1_get_track: unimplemented for id ${v.id}`)
	} */

	return false // no mutation
}

// tries to extrapolate identifiers from the track metadata
// TODO: unimplemented for now
async function pass_track_meta_ident() {
	/* const k = await db.schema.select()
		.from(schema.track)
		.where(sql`${schema.track.meta_spotify_id} is null`)

	// use spotify search feature to look for isrc

	for (const v of k) {
		console.log(`pass_track_meta_spotify_id: unimplemented for ${v.name} (id: ${v.id})`)
	} */

	// TODO: implement

	return false // no mutation
}

// extrapolate albums from tracks and artists
// TODO: currently spotify only, would get much bigger
//       should extract into its own file?
// TODO: extrapolate paginated artist albums into metadata, then use it here
async function pass_album_extrapolate() {
	// select all track metadata entries, they always contain albums

	// force types
	/* type Entry = { track_id: TrackId, meta: SpotifyTrack }

	const k: Entry[] = (await db.schema.select({ meta: schema.track_meta.meta })
		.from(schema.track_meta)
		.where(sql`${schema.track_meta.kind} = 'spotify_v1_get_track'`)) as Entry[]

	// to avoid weird phase ordering, construct the absolute identifiers as soon as possible now
	// same issue as the track thing, insertions and queries based on unreliable identifiers
	// (spotify ids) this can cause duplicate data which also must be interned.
	// that is annoying, do it all in one go.
	// also keep in mind that creating an article of data must contain at least one absolute identifier

	// 1. spotify.album_extrapolate          (albums with unreliable spotify id)
	// 2. spotify.meta.spotify_v1_get_album  (albums get reliable metadata)
	// 3. spotify.album_duplicates           (intern albums with duplicate reliable metadata but different unreliable spotify id)
	// 4. spotify.track_extrapolate          (tracks with unreliable spotify id)
	//    continue the cycle...

	// 1. spotify.album_extrapolate          (albums with reliable metadata + unreliable spotify id)
	// 2. spotify.track_extrapolate          (tracks with reliable metadata + unreliable spotify id)

	// prune into a set
	const albums = new Set<string>(k.map(v => v.meta.album.id))

	// try to prune the dataset again by removing spotify ids that we already have, this won't get all
	// of them though. we'll still have duplicates which will be weeded out anyway

	// selecting everything not in the set isn't really possible in SQL efficiently?
	// it's going to hurt requesting this much data

	const k2 = await db.schema.select({ meta_spotify_id: schema.album.meta_spotify_id })
		.from(schema.album)
		.where(sql`${schema.album.meta_spotify_id} is not null`)
	
	for (const v of k2) {
		albums.delete(v.meta_spotify_id!)
	}

	// make the requests in 20 id batches
	let offset = 0
	const album_spotify_ids = Array.from(albums)

	while (offset < album_spotify_ids.length) {
		const sp = safepoint('spotify.album_extrapolate.batch20')
		const noffset = offset + 20
		const batch = album_spotify_ids.slice(offset, noffset)
		const utc = Date.now()
		const albums = await spotify_api.albums.get(batch)

		const album_ids: TrackId[] = []

		for (const v of albums) {
			let existing_album_id = await db.extrapolate_spotify_v1_get_album(v)

			if (existing_album_id === undefined) {
				const album_entry: AlbumEntry = {
					name: v.name,
					name_locale: {},

					utc: utc,

					total_tracks: v.total_tracks,

					meta_isrc: v.external_ids?.isrc,
					meta_spotify_id: v.id,
				}

				const r = await db.schema.insert(schema.album)
					.values(album_entry)
					.returning({ id: schema.album.id })
				
				existing_album_id = r[0].id
			}

			album_ids.push(existing_album_id)
		}

		const album_metas: AlbumMetaEntry[] = albums.map((v, idx) => {
			return {
				utc: utc,
				album_id: album_ids[idx],
				kind: 'spotify_v1_get_album',
				meta: v,
			}
		})

		console.log(`pass_album_spotify_album_extrapolate: batch ${offset} to ${noffset} (slice: ${batch.length}, total: ${album_spotify_ids.length})`)

		await db.upsert_album_metas(album_metas)

		sp.release()
		offset = noffset
	}

	return album_spotify_ids.length > 0 */ // mutation
	return false
}

// insert a spotify id where albums don't have it
// TODO: unimplemented for now
async function pass_album_meta_spotify_v1_get_album() {
	/* const k = await db.schema.select({ id: schema.album.id, meta_spotify_id: schema.album.meta_spotify_id })
		.from(schema.album)
		.where(sql`${schema.album.meta_spotify_id} is not null and not exists (
			select 1
			from ${schema.album_meta}
			where ${schema.album_meta.album_id} = ${schema.album.id} and ${schema.album_meta.kind} = 'spotify_v1_get_album'
		)`)
	
	for (const v of k) {
		console.log(`pass_album_meta_spotify_v1_get_album: unimplemented for id ${v.id}`)
	} */

	return false // no mutation
}

export enum PassFlags {
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

	return ret.join(' | ')
}

export type PassBlock = {
	name: string
	fn: () => Promise<boolean>
	flags: number & PassFlags
}

export const passes: PassBlock[] = [
	{ name: 'track.meta.ident', fn: pass_track_meta_ident, flags: PassFlags.spotify },
	{ name: 'track.meta.spotify_v1_get_track', fn: pass_track_meta_spotify_v1_get_track, flags: PassFlags.spotify },
	{ name: 'track.meta.spotify_v1_audio_features', fn: pass_track_meta_spotify_v1_audio_features, flags: PassFlags.spotify },
	{ name: 'album.extrapolate', fn: pass_album_extrapolate, flags: PassFlags.spotify },
	{ name: 'album.meta.spotify_v1_get_album', fn: pass_album_meta_spotify_v1_get_album, flags: PassFlags.spotify },
]
