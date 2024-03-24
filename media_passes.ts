import { sql } from "drizzle-orm";
import { db } from "./db";
import { PassBlock, PassFlags, register_backoff_album, register_backoff_track, run_with_concurrency_limit } from "./pass";
import * as schema from './schema';
import { mime_ext } from "./mime";
import { create_sharded_lazy_bunfile, create_sharded_lazy_path } from "./media_fs";
import { safepoint } from "./safepoint";
import { youtube_cookie_header } from "./youtube";
import ytdl from "ytdl-core";
import * as YTDlpWrap from "yt-dlp-wrap"; // sigh

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
		const [file, hash] = create_sharded_lazy_bunfile(ext)

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

async function pass_track_media_audio0_youtube() {
	const k0 = db.select({ id: schema.track.id, meta_youtube_music_id: schema.track.meta_youtube_music_id })
		.from(schema.track)
		.where(sql`meta_youtube_music_id is not null and not exists (
			select 1 from media_fs where track_id = track.id and kind = 'audio0'
		) and id not in (
			select track_id from pass_backoff where pass = 'track.media.audio0_youtube'
		)`)
		.all()
	
	if (k0.length === 0) {
		return
	}

	/* run_with_concurrency_limit(k0, 1, async (entry) => {
		const info = await ytdl.getInfo(entry.meta_youtube_music_id!, {
			requestOptions: {
				headers: {
					Cookie: youtube_cookie_header,
				}
			}
		})

		const fmt = ytdl.chooseFormat(info.formats, { filter: "audioonly", quality: "highestaudio" })

		console.log(`pass_track_media_audio0_youtube: track ${entry.id} chosen format: ${fmt.mimeType}`)

		const ext = mime_ext(fmt.mimeType ?? "audio/mp3")
		const [file, hash] = create_sharded_lazy_path(ext)

		const resp = ytdl.downloadFromInfo(info, {
			filter: "audioonly", quality: "highestaudio", highWaterMark: 1 << 26, dlChunkSize : 1024 * 1024,
			requestOptions: {
				headers: {
					Cookie: youtube_cookie_header,
				}
			}
		})

		console.log(`pass_track_media_audio0_youtube: downloading audio0 for track ${entry.id}, hash: ${hash}`)

		// Bun currently doesn't support nodejs stream writes, so we have to buffer the entire file in memory
		const components = []
		for await (const chunk of resp) {
			components.push(chunk)
		}

		await Bun.write(file, components) // ignore failure

		db.insert(schema.media_fs)
			.values({
				hash,
				kind: 'audio0',
				track_id: entry.id
			})
			.run()
	}) */

	const ytdl = new YTDlpWrap.default()

	run_with_concurrency_limit(k0, 50, async (entry) => {
		const [path, hash] = create_sharded_lazy_path('.webm')

		console.log(`pass_track_media_audio0_youtube: downloading audio0 for track ${entry.id}, hash: ${hash}`)

		try {
			const k = await ytdl.execPromise([
				'-f',
				"bestaudio[ext=webm]",
				`https://www.youtube.com/watch?v=${entry.meta_youtube_music_id!}`,
				'-o',
				path
			])
		} catch {
			console.error(`pass_track_media_audio0_youtube: failed to download audio0 for track ${entry.id}, hash: ${hash}`)
			register_backoff_track(entry.id, 'track.media.audio0_youtube')
			return
		}

		db.insert(schema.media_fs)
			.values({
				hash,
				kind: 'audio0',
				track_id: entry.id
			})
			.run()
	})
}

// no need to return truthy on mutations, since these don't discover new data
export const media_passes: PassBlock[] = [
	{ name: 'album.media.cover_art_small_spotify', fn: pass_album_media_cover_art_small_spotify, flags: PassFlags.none },
	{ name: 'track.media.audio0_youtube', fn: pass_track_media_audio0_youtube, flags: PassFlags.youtube_dl },
]
