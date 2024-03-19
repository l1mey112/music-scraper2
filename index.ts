import { sql } from "drizzle-orm";
import { db } from "./db";
import * as schema from "./schema";
import { spotify_api, spotify_create, spotify_user_api, spotify_user_create, thirdparty_spotify_index_liked } from "./spotify";
import { meta_passes } from "./meta_passes";
import { passflags_string } from "./pass";
import { PassFlags } from "./pass";
import { qobuz_create, qobuz_keys, qobuz_token } from "./qobuz";
import { deezer_api_json, deezer_create, deezer_downloadable_q2 } from "./deezer";
import { youtube_music, youtube_music_create } from "./youtube";
import { media_passes } from "./media_passes";

await deezer_create()

const f = Bun.file("testout")
const k = await deezer_downloadable_q2(1690633187, f)

console.log(k)

/* if (false) {
	await spotify_user_create()
	await thirdparty_spotify_index_liked()
	console.log('done')
	process.exit(0)
}

let flags = meta_passes.reduce((acc, v) => acc | v.flags, 0)

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

if (flags) {
	console.error(`unimplemented pass flags: ${passflags_string(flags)}`)
	process.exit(1)
}

let changed
let wave */

/* wave = 0
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
} while (changed) */

/* wave = 0
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
