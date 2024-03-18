import { sql } from "drizzle-orm";
import { db } from "./db";
import * as schema from "./schema";
import { spotify_api, spotify_create, spotify_user_api, spotify_user_create, thirdparty_spotify_index_liked } from "./spotify";
import { PassFlags, passes, passflags_string } from "./pass";
import { qobuz_create, qobuz_keys, qobuz_token } from "./qobuz";

// 252881807 (MONEY ON THE DASH - ACAPELLA)

/* const url = `https://www.qobuz.com/api.json/0.2/track/get?app_id=${qobuz_keys.app_id}&track_id=252881807`

const response = await fetch(url, {
	method: 'GET',
	headers: {
		"X-App-Id": qobuz_keys.app_id,
		"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:83.0) Gecko/20100101 Firefox/83.0",
		"X-User-Auth-Token": qobuz_token,
	}
})

console.log(response)
console.log(await response.text()) */

let flags = passes.reduce((acc, v) => acc | v.flags, 0)

console.log(`passflags: ${passflags_string(flags)}`)

if (false) {
	await spotify_user_create()
	await thirdparty_spotify_index_liked()
}

// TODO: add a readonly and readwrite db connection flag
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

if (flags) {
	console.error(`unimplemented pass flags: ${passflags_string(flags)}`)
	process.exit(1)
}

let changed
let wave = 0

do {
	changed = false

	for (const pass of passes) {
		// stats
		// console.log(`stats: ${JSON.stringify(stats)}`)

		console.log(`pass(${wave}): ${pass.name} (flags: ${passflags_string(pass.flags)})`)

		if (await pass.fn()) {
			changed = true
		}
	}

	wave++
} while (changed)
