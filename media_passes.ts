import { sql } from "drizzle-orm";
import { db } from "./db";
import { PassBlock, PassFlags, register_backoff_album, run_with_concurrency_limit } from "./pass";
import * as schema from './schema';
import { mime_ext } from "./mime";
import { create_sharded_path } from "./media_fs";
import { safepoint } from "./safepoint";

async function pass_album_media_cover_art_small_spotify() {
	const k0 = db.select({ id: schema.album.id, meta_spotify_v1_get_album: schema.album.meta_spotify_v1_get_album })
		.from(schema.album)
		.where(sql`meta_spotify_v1_get_album is not null and not exists (
			select 1 from media_fs where album_id = album.id and kind = 'cover_art_small'
		) and id not in (
			select album_id from pass_backoff where pass = 'album.media.cover_art_small_spotify'
		)`)
		.all()

	// 'cover_art_small' size >= 256x256 < 512x512
	run_with_concurrency_limit(k0, 5, async (entry) => {
		const images = entry.meta_spotify_v1_get_album!.images

		let image
		
		for (const img of images) {
			if (img.width >= 256 && img.width < 512 && img.height >= 256 && img.height < 512) {
				image = img
				break
			}
		}

		if (!image) {
			console.error(`pass_album_media_cover_art_small_spotify: no image found for album ${entry.meta_spotify_v1_get_album!.name} (id: ${entry.id})`)
			register_backoff_album(entry.id, 'album.media.cover_art_small_spotify')
			return
		}

		const resp = await fetch(image.url)

		if (!resp.ok) {
			console.error(`pass_album_media_cover_art_small_spotify: fetch failed for album ${entry.meta_spotify_v1_get_album!.name} (id: ${entry.id})`)
			register_backoff_album(entry.id, 'album.media.cover_art_small_spotify')
			return
		}

		const ext = mime_ext(resp.headers.get("content-type"))
		const [file, hash] = create_sharded_path(ext)

		await Bun.write(file, resp) // ignore failure
		
		db.insert(schema.media_fs)
			.values({
				hash,
				kind: 'cover_art_small',
				album_id: entry.id
			})
			.run()

		console.log(`pass_album_media_cover_art_small_spotify: wrote cover_art_small for album ${entry.meta_spotify_v1_get_album!.name} (id: ${entry.id})`)
	})
}

// no need to return truthy on mutations, since these don't discover new data
export const media_passes: PassBlock[] = [
	{ name: 'album.media.cover_art_small_spotify', fn: pass_album_media_cover_art_small_spotify, flags: PassFlags.none }
]
