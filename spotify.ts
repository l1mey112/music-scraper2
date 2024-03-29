import { SpotifyApi, AccessToken, User } from '@spotify/web-api-ts-sdk';
import { db } from './db';
import { TrackEntry } from './types';
import { TrackId } from "./types";
import * as schema from './schema';
import { sql } from 'drizzle-orm';
import { safepoint } from './safepoint';

// fuckit
const scopes = [
	"ugc-image-upload",
	"user-read-recently-played",
	"user-top-read",
	"user-read-playback-position",
	"user-read-playback-state",
	"user-modify-playback-state",
	"user-read-currently-playing",
	"app-remote-control",
	"playlist-modify-public",
	"playlist-modify-private",
	"playlist-read-private",
	"playlist-read-collaborative",
	"user-follow-modify",
	"user-library-modify",
	"user-library-read",
	"user-read-email",
	"user-read-private",
]

export const client_id = process.env.CLIENT_ID!
export const client_secret = process.env.CLIENT_SECRET!
export const client_redirect_uri = process.env.CLIENT_REDIRECT_URI!

if (!client_id || !client_secret || !client_redirect_uri) {
	console.error('missing client id, client secret, or client redirect uri')
	process.exit(1)
}

async function spotify_auth_user(): Promise<SpotifyApi> {
	let sdk: SpotifyApi | undefined

	console.log(`spotify: listening on http://localhost:8080/`)
	console.log(`spotify: awaiting accept`)

	const server = Bun.serve({
		port: 8080,
		async fetch(req) {
			const url = new URL(req.url);
			out: switch (url.pathname) {
				case '/': {
					const url = 'https://accounts.spotify.com/authorize' +
						'?response_type=code' +
						'&client_id=' + encodeURIComponent(client_id) +
						'&scope=' + encodeURIComponent(scopes.join(' ')) +
						'&redirect_uri=' + encodeURIComponent(client_redirect_uri)

					return Response.redirect(url, 303)
				}
				case '/callback': {
					const code = url.searchParams.get('code')

					if (!code) {
						break out
					}

					const auth = btoa(client_id + ':' + client_secret)
		
					const auth_url = 'https://accounts.spotify.com/api/token' +
						'?grant_type=authorization_code' +
						'&code=' + encodeURIComponent(code) +
						'&redirect_uri=' + encodeURIComponent(client_redirect_uri)	

					const auth_req = new Request(auth_url, {
						method: 'POST',
						headers: {
							'Authorization': 'Basic ' + auth,
							'Content-Type': 'application/x-www-form-urlencoded'
						},
					})

					const auth_data = await fetch(auth_req)

					if (auth_data.status !== 200) {
						console.log(auth_data);
						throw new Error('auth failed')
					}
					const auth_json = await auth_data.json()

					sdk = SpotifyApi.withAccessToken(client_id, auth_json as AccessToken);

					return new Response('auth completed, you may close this window now', {status: 200})
				}
			}
			return new Response('Not Found', {status: 404})
		},
	});

	while (!sdk) {
		await new Promise((resolve) => setTimeout(resolve, 1))
	}

	server.stop(true)

	return sdk
}

export let spotify_api: SpotifyApi
export let spotify_user_api: SpotifyApi
export let spotify_user: User

export async function spotify_create() {
	spotify_api = SpotifyApi.withClientCredentials(client_id, client_secret, scopes)
	console.log(`spotify: created api instance with client credentials`)
}

export async function spotify_user_create() {
	spotify_user_api = await spotify_auth_user()
	spotify_user = await spotify_user_api.currentUser.profile()

	console.log(`spotify: logged in as ${spotify_user.display_name}, ${spotify_user.id}`)

	const q = db.select({ count: sql<number>`count(*)` })
		.from(schema.thirdparty_spotify_users)
		.where(sql`spotify_id = ${spotify_user.id}`)
		.limit(1)
		.all()

	if (q[0].count === 0) {
		db.insert(schema.thirdparty_spotify_users)
			.values({spotify_id: spotify_user.id})
			.run()
	}
}

// TODO: whilst it uses the current user, this can have issues if the track isn't available in the region
//       for an unbiased API search/index, use the client credentials flow/not the saved tracks API.
//       this will require double request/overhead
export async function thirdparty_spotify_index_liked() {
	const ini = await spotify_user_api.currentUser.tracks.savedTracks(1)
	let total = ini.total

	// incrementalism assumes that new songs are added to the top

	// TODO: currently scrapes to 50 incrementsm my 7235 songs go to 7250
	//       how does that even happen? what data is the extra songs?

	// TODO: when cancelled halfway through, it won't start back where it started
	//       probably because it goes from top (1) to bottom instead of bottom to up as it was originally

	const db_count_q = db.select({ count: sql<number>`count(*)` })
		.from(schema.thirdparty_spotify_saved_tracks)
		.where(sql`spotify_user_id = ${spotify_user.id}`)
		.all()
	const db_count = db_count_q[0].count

	total -= db_count

	let offset = 0

	while (offset < total) {
		const sp = safepoint('spotify.index_liked_songs.batch50')
		
		const utc_millis = Date.now()

		const req = await spotify_user_api.currentUser.tracks.savedTracks(50, offset)
		const saved_track_ids: TrackId[] = []

		for (const v of req.items) {
			const track = v.track

			if (track.is_local) {
				console.log(`spotify: skipping local track ${track.name}, id: ${track.id}`)
				continue
			}

			console.log(`spotify: indexing track ${track.name}, id: ${track.id}`)

			const spotify_id = track.id
			const isrc = track.external_ids?.isrc ? track.external_ids?.isrc : null

			if (!isrc) {
				// spotify are assholes and it's possible any of these can be null
				// but it's incredibly rare (100 in 1 000 000 tracks, trust me ive scraped a lot of data)
				console.error(`thirdparty_spotify_index_liked: warn no isrc for track ${v.track.name} (id: ${v.track.id})`)
			}

			// select 1 track id match on spotify id
			const k0 = db.select({ id: schema.track.id })
				.from(schema.track)
				.where(sql`meta_spotify_id = ${spotify_id}`)
				.limit(1)
				.all()

			let track_id: TrackId | undefined = k0[0]?.id

			if (!track_id) {
				// insert track
				const entry: TrackEntry = {
					name: track.name,

					meta_isrc: isrc,
					meta_spotify_id: spotify_id,
					meta_spotify_v1_get_track: track,
				}

				const k1 = db.insert(schema.track)
					.values(entry)
					.returning({ id: schema.track.id })
					.all()
				
				track_id = k1[0].id
			}

			saved_track_ids.push(track_id)
		}

		const saved_tracks = req.items.map((v, idx) => {
			// spotify provides ISO 8601 date strings
			const save_at_millis = new Date(v.added_at).getTime()

			return {
				save_utc: save_at_millis,
				spotify_user_id: spotify_user.id,
				track_id: saved_track_ids[idx],
			}
		})

		db.insert(schema.thirdparty_spotify_saved_tracks)
			.values(saved_tracks)
			.onConflictDoNothing()
			.run()

		offset += 50
		sp.release()
	}
}
