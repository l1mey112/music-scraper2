import { sql } from "drizzle-orm";
import { db } from "./db"
import type { TrackMetaEntry } from './schema';
import * as schema from './schema';
import { spotify_api } from "./spotify";
import { safepoint } from "./safepoint";

// select all tracks without audio features in meta
async function pass_meta_spotify_v1_audio_features() {
	// select all tracks without a single audio features in meta
	// how could you express this better in drizzle?
	const k = await db.schema.select({ id: schema.track.id, meta_spotify_id: schema.track.meta_spotify_id })
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
}

// insert a spotify id where tracks don't have it
// TODO: unimplemented for now
async function pass_meta_spotify_id() {
	const k = await db.schema.select()
		.from(schema.track)
		.where(sql`${schema.track.meta_spotify_id} is null`)

	// use spotify search feature to look for isrc
	
	for (const v of k) {
		console.log(`pass_meta_spotify_id: unimplemented for ${v.name} (id: ${v.id})`)
	}
}

export enum PassFlags {
	spotify = 1 << 0,
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
	fn: () => Promise<void>
	flags: number & PassFlags
}

export const passes: PassBlock[] = [
	{ name: 'meta.spotify_id', fn: pass_meta_spotify_id, flags: PassFlags.spotify },
	{ name: 'meta.spotify_v1_audio_features', fn: pass_meta_spotify_v1_audio_features, flags: PassFlags.spotify },
]
