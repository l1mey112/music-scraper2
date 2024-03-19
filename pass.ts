import { AlbumId, ArtistId, TrackId } from "./types"
import { db } from "./db"
import * as schema from './schema';

// register backoff for a pass if it failed and would be expensive to compute again

// for now just make it never retry
const retry_backoff_after_millis = 1000 * 60 * 60 * 24 * 365 * 1000 // 1000 years
export const retry_cutoff = Date.now() - retry_backoff_after_millis

export function register_backoff_track(id: TrackId, pass_name: string) {
	console.log(`register_backoff_track: registering backoff for track ${id} for pass ${pass_name}`)

	db.insert(schema.pass_backoff)
		.values({ track_id: id, utc: Date.now(), pass: pass_name })
		.run()
}

export function register_backoff_album(id: AlbumId, pass_name: string) {
	console.log(`register_backoff_album: registering backoff for album ${id} for pass ${pass_name}`)

	db.insert(schema.pass_backoff)
		.values({ album_id: id, utc: Date.now(), pass: pass_name })
		.run()
}

export function register_backoff_artist(id: ArtistId, pass_name: string) {
	console.log(`register_backoff_artist: registering backoff for artist ${id} for pass ${pass_name}`)

	db.insert(schema.pass_backoff)
		.values({ artist_id: id, utc: Date.now(), pass: pass_name })
		.run()
}

export enum PassFlags {
	none = 0,
	spotify = 1 << 0,
	spotify_user = 1 << 1,
	qobuz_user = 1 << 2,
	deezer_arl = 1 << 3,
	youtube_music = 1 << 4
}

export type PassBlock = {
	name: string;
	fn: () => boolean | Promise<boolean>;
	flags: number & PassFlags;
}

export function passflags_string(flags: number & PassFlags) {
	const ret = [];

	for (const [k, v] of Object.entries(PassFlags)) {
		if (flags & v as PassFlags) {
			ret.push(k);
		}
	}

	if (ret.length === 0) {
		ret.push('none');
	}

	return ret.join(' | ');
}

export async function run_with_concurrency_limit<T>(arr: T[], concurrency_limit: number, next: (v: T) => Promise<void>): Promise<void> {
	const active_promises: Promise<void>[] = [];

	for (const item of arr) {
		// wait until there's room for a new operation
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

	// wait for all active operations to complete
	await Promise.all(active_promises);
}
