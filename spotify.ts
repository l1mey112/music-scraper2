import { SpotifyApi, type AccessToken, type User } from '@spotify/web-api-ts-sdk';
import { db } from './db';
import type { TrackEntry, TrackId, TrackMetaEntry } from './schema';
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

const client_id = process.env.CLIENT_ID!
const client_secret = process.env.CLIENT_SECRET!
const client_redirect_uri = process.env.CLIENT_REDIRECT_URI!

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

	const q = await db.schema.select({ count: sql<number>`count(*)` })
		.from(schema.thirdparty_spotify_users)
		.where(sql`spotify_id = ${spotify_user.id}`)
		.limit(1)

	if (q[0].count === 0) {
		await db.schema.insert(schema.thirdparty_spotify_users)
			.values({spotify_id: spotify_user.id})
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

	const db_count_q = await db.schema.select({ count: sql<number>`count(*)` })
		.from(schema.thirdparty_spotify_saved_tracks)
		.where(sql`spotify_user_id = ${spotify_user.id}`)
	const db_count = db_count_q[0].count

	total -= db_count

	let offset = 0

	while (offset < total) {
		const sp = safepoint('spotify.index_liked_songs.batch50')
		
		const utc_millis = Date.now()

		const req = await spotify_user_api.currentUser.tracks.savedTracks(50, offset)
		const saved_track_ids: TrackId[] = []
		const saved_track_metas: TrackMetaEntry[] = []

		for (const v of req.items) {
			const track = v.track

			if (track.is_local) {
				console.log(`spotify: skipping local track ${track.name}, id: ${track.id}`)
				continue
			}

			// spotify provides ISO 8601 date strings
			let existing_track_id = await db.extrapolate_spotify_v1_get_track(track)

			if (existing_track_id === undefined) {
				const isrc = track.external_ids?.isrc ? track.external_ids?.isrc : null

				if (!isrc) {
					// spotify are assholes and it's possible any of these can be null
					// but it's incredibly rare (100 in 1 000 000 tracks, trust me ive scraped a lot of data)
					console.error(`thirdparty_spotify_index_liked: warn no isrc for track ${v.track.name} (id: ${v.track.id})`)
				}

				const entry: TrackEntry = {
					name: v.track.name,
					name_locale: {},

					utc: utc_millis,

					meta_isrc: isrc, 
					meta_spotify_id: v.track.id,
				}

				// insert the track
				const k = await db.schema.insert(schema.track)
					.values(entry)
					.returning({ id: schema.track.id })
				
				existing_track_id = k[0].id
			}

			saved_track_metas.push({
				track_id: existing_track_id,
				kind: 'spotify_v1_get_track',
				utc: utc_millis,
				meta: track,
			})
			saved_track_ids.push(existing_track_id)
		}
		
		const saved_tracks = req.items.map((v, idx) => {
			const save_at_millis = new Date(v.added_at).getTime()

			return {
				save_utc: save_at_millis,
				spotify_user_id: spotify_user.id,
				track_id: saved_track_ids[idx],
			}
		})

		await db.upsert_track_metas(saved_track_metas)
		await db.schema.insert(schema.thirdparty_spotify_saved_tracks)
			.values(saved_tracks)
			.onConflictDoNothing()

		offset += 50
		sp.release()
	}
}
