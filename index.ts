import { sql } from "drizzle-orm";
import { db } from "./db";
import * as schema from "./schema";
import { spotify_api, spotify_create, spotify_user_api, spotify_user_create, thirdparty_spotify_index_liked } from "./spotify";
import { PassFlags, passes, passflags_string } from "./pass";

const flags = passes.reduce((acc, v) => acc | v.flags, 0)

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
} else if (flags != 0) {
	console.error(`unimplemented pass flags: ${passflags_string(flags)}`)
	process.exit(1)
}

let changed

do {
	changed = false

	for (const pass of passes) {
		console.log(`running pass: ${pass.name} (flags: ${passflags_string(pass.flags)})`)

		if (await pass.fn()) {
			changed = true
		}
	}
} while (changed)
