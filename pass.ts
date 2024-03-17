import { sql } from "drizzle-orm";
import { db, pass_track_meta_weak } from "./db"
import { TrackMetaEntry, SpotifyTrack, AlbumEntry, AlbumMetaEntry, SpotifyAlbum, TrackId, SpotifyAudioFeatures, SpotifyId } from './types';
import * as schema from './schema';
import { spotify_api } from "./spotify";
import { safepoint } from "./safepoint";

function one_of_each(kind0: string, kind1: string) {
	return db.select({ track_id: schema.track_meta.track_id })
		.from(schema.track_meta)
		.where(sql`${schema.track_meta.kind} = ${kind0}`)
		.groupBy(schema.track_meta.track_id)
		.having(sql`count(*) != (select count(*) from ${schema.track_meta} where ${schema.track_meta.track_id} = ${schema.track_meta.track_id} and ${schema.track_meta.kind} = ${kind1})`)
		.prepare()
}

const spotify_v1_get_track = one_of_each('spotify_id', 'spotify_v1_get_track')
const spotify_v1_audio_features = one_of_each('spotify_id', 'spotify_v1_audio_features')

// select all tracks without audio features in meta
function pass_track_meta_spotify_v1_audio_features() {
	// one of each spotify id
	// so, if there are different amounts of audio features compared to spotify id meta on a track, we need to fetch them
	// comparing `spotify_v1_audio_features` to `spotify_id`, if they differ in length, we need to fetch them

	// select all track ids that have mismatching count of audio features to spotify ids
	// this will ignore nulls
	const k = spotify_v1_audio_features.all()

	const pair_trackid = []
	const pair_spotifyid = []

	// construct pairs of track id and spotify id
	// diff out the existing audio features
	for (const v of k) {
		const spotify_id: { meta: SpotifyId }[] = db.select({ meta: schema.track_meta.meta })
			.from(schema.track_meta)
			.where(sql`${schema.track_meta.kind} = 'spotify_id' and ${schema.track_meta.track_id} = ${v.track_id}`)
			.all() as any

		const audio_features: { meta: SpotifyAudioFeatures | null }[] = db.select({ meta: schema.track_meta.meta })
			.from(schema.track_meta)
			.where(sql`${schema.track_meta.kind} = 'spotify_v1_audio_features' and ${schema.track_meta.track_id} = ${v.track_id}`)
			.all() as any
		
		if (spotify_id.length === audio_features.length) {
			console.error(`pass_meta_spotify_v1_audio_features: warn same count of audio features to spotify ids for track id ${v.track_id}`)
		}

		// diff out the existing audio features
		// find all spotify ids that arent existing audio features

		const spotify_id_new = spotify_id.filter(v => {
			for (const w of audio_features) {
				if (v.meta === w.meta) {
					return false
				}
			}
			return true
		})
	}

	/* let offset = 0

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
	/*
	// use spotify search feature to look for isrc

	for (const v of k) {
		console.log(`pass_track_meta_spotify_v1_get_track: unimplemented for id ${v.id}`)
	} */

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
	/*
	
	for (const v of k) {
		console.log(`pass_album_meta_spotify_v1_get_album: unimplemented for id ${v.id}`)
	} */

	return false // no mutation
}

// TODO: touch the network to search for identifiers
async function pass_track_meta_search_ident() {
	// search for isrc
	// search for spotify id

	return false // no mutation
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
export const passes: PassBlock[] = [
	{ name: 'track.meta.weak', fn: pass_track_meta_weak, flags: PassFlags.none },
	{ name: 'track.meta.search_ident', fn: pass_track_meta_search_ident, flags: PassFlags.spotify },
	{ name: 'track.meta.spotify_v1_get_track', fn: pass_track_meta_spotify_v1_get_track, flags: PassFlags.spotify },
	{ name: 'track.meta.spotify_v1_audio_features', fn: pass_track_meta_spotify_v1_audio_features, flags: PassFlags.spotify },
	{ name: 'album.extrapolate', fn: pass_album_extrapolate, flags: PassFlags.spotify },
	{ name: 'album.meta.spotify_v1_get_album', fn: pass_album_meta_spotify_v1_get_album, flags: PassFlags.spotify },
]
