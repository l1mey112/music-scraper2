import { sql } from "drizzle-orm";
import { db } from "./db";
import * as schema from "./schema";
import { spotify_api, spotify_create, spotify_user_api, spotify_user_create, thirdparty_spotify_index_liked } from "./spotify";
import { meta_passes } from "./meta_passes";
import { passflags_string } from "./pass";
import { PassFlags } from "./pass";
import { qobuz_create, qobuz_keys, qobuz_token } from "./qobuz";
import { deezer_api_json, deezer_create, deezer_downloadable_q2 } from "./deezer";
import { youtube_dl_create, youtube_music, youtube_music_create } from "./youtube";
import { media_passes } from "./media_passes";

if (false) {
	await spotify_user_create()
	await thirdparty_spotify_index_liked()
	console.log('done')
	process.exit(0)
}

/* let flags = 0
flags |= meta_passes.reduce((acc, v) => acc | v.flags, 0)
flags |= media_passes.reduce((acc, v) => acc | v.flags, 0)

console.log(`passflags: ${passflags_string(flags)}`)

if (flags & PassFlags.spotify) {
	// TODO: possibly create a flag for `spotify_user` to perform user actions
	//       honestly i should create a direct logged in user and non logged in user
	//       non logged in user doesn't come with location restrictions
	await spotify_create()
	flags &= ~PassFlags.spotify
}

if (flags & PassFlags.qobuz_user) {
	await qobuz_create()
	flags &= ~PassFlags.qobuz_user
}

if (flags & PassFlags.deezer_arl) {
	await deezer_create()
	flags &= ~PassFlags.deezer_arl
}

if (flags & PassFlags.youtube_music) {
	await youtube_music_create()
	flags &= ~PassFlags.youtube_music
}

// NO YOUTUBE DL
flags &= ~PassFlags.youtube_dl 
//if (flags & PassFlags.youtube_dl) {
//	await youtube_dl_create()
//	flags &= ~PassFlags.youtube_dl 
//}

if (flags) {
	console.error(`unimplemented pass flags: ${passflags_string(flags)}`)
	process.exit(1)
}

let changed
let wave

wave = 0
do {
	changed = false

	for (const pass of meta_passes) {
		// stats
		// console.log(`stats: ${JSON.stringify(stats)}`)

		if (await pass.fn()) {
			console.log(`pass(${wave}): ${pass.name} (flags: ${passflags_string(pass.flags)})`)
			changed = true
		}
	}

	wave++
} while (changed)

wave = 0
do {
	changed = false

	for (const pass of media_passes) {
		if (await pass.fn()) {
			console.log(`pass(${wave}): ${pass.name} (flags: ${passflags_string(pass.flags)})`)
			changed = true
		}
	}

	wave++
} while (changed) */

const rightdir = `here`

// for first 1000 songs in the library, select their albums
const albums = db.selectDistinct({ album_id: schema.album.id, name: schema.album.name })
	.from(sql`'thirdparty:spotify_saved_tracks' saved_tracks`)
	.orderBy(sql`utc desc`)
	.leftJoin(schema.track, sql`track.id = saved_tracks.track_id`)
	.leftJoin(schema.album, sql`album.id = track.album_id`)
	.leftJoin(sql`media_fs fs0`, sql`fs0.track_id = track.id and fs0.kind = 'audio0'`)
	.leftJoin(sql`media_fs fs1`, sql`fs1.album_id = album.id and fs1.kind = 'cover_art_small'`)
	.limit(300)
	.all()

import fs from "fs"

for (const album of albums) {
	const cover = db.select({ hash: schema.media_fs.hash })
		.from(schema.media_fs)
		.where(sql`album_id = ${album.album_id} and kind = 'cover_art_small'`)
		.limit(1)
		.get()
	
	const cover_path = `media/${cover!.hash.slice(0, 2)}/${cover!.hash}`
	
	const tracks = db.select({ track_id: schema.track.id, name: schema.track.name, audio: sql<string>`fs0.hash`, track_number: schema.track.album_track_number })
		.from(schema.track)
		.where(sql`track.album_id = ${album.album_id}`)
		.innerJoin(sql`media_fs fs0`, sql`fs0.track_id = track.id and fs0.kind = 'audio0'`)
		.all()

	// 139/150
	if (tracks.length === 0) {
		// how did we get here?
		continue
	}
	
	const first_artist = db.select({ name: schema.artist.name })
		.from(schema.track_artists)
		.where(sql`track_artists.track_id = ${tracks[0].track_id} and track_artists.is_first`)
		.innerJoin(schema.artist, sql`artist.id = track_artists.artist_id`)
		.limit(1)
		.get()
	
	function r_fext(filename: string): string {
		const parts = filename.split(".");
		if (parts.length > 1) {
			parts.pop();
		}
		return parts.join(".");
	}

	const album_base = `here/${album.name!.replace(/[<>:"'\/\\|?*]/g, "_")}`
	if (!fs.existsSync(album_base)) {
		fs.mkdirSync(album_base, { recursive: true });
	}

	const ffmpegi = []

	for (const track of tracks) {

		const audio_path = `media/${track.audio.slice(0, 2)}/${track.audio}`
		const safe_track_name = track.name.replace(/[<>:"'\/\\|?*]/g, "_")
		
		const nfp = `${album_base}/${safe_track_name}.mp3`;

		if (fs.existsSync(nfp)) {
			continue
		}

		const args = [
			"-i",
			audio_path,
			"-i",
			`${cover_path}`,
			'-c:v', 'copy', // -c copy
			"-map",
			"0",
			"-map",
			"1",
			"-id3v2_version",
			"3",
			"-write_id3v1",
			"1",
			"-metadata:s:v",
			"title=Album cover",
			"-metadata:s:v",
			"comment=Cover (front)",
			"-metadata",
			`title=${track.name}`,
			"-metadata",
			`album=${album.name}`,
			/* "-metadata",
			`date=${album.release_date}`, */
			"-metadata",
			`artist=${first_artist!.name}`,
			"-metadata",
			`track=${track.track_number}/${tracks.length}`,
			"-y",
			nfp,
		];

		console.log(`ffmpeg ${args.join(" ")}`)

		const proc = Bun.spawn(["ffmpeg", ...args]);
		ffmpegi.push(proc)
	}

	await Promise.all(ffmpegi.map(v => v.exited))
}
