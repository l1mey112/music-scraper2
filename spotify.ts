import { SpotifyApi, type AccessToken, type User, type Track } from '@spotify/web-api-ts-sdk';
import Database from 'bun:sqlite';
import { db } from './db';
import * as schema from './schema';
import type { TrackEntry } from './schema';
import { sql } from 'drizzle-orm';
import { sigint_region, sigint_region_end } from './sigint';

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
].join(' ')

export async function auth(): Promise<SpotifyApi> {
	const client_id = process.env.CLIENT_ID!
	const client_secret = process.env.CLIENT_SECRET!
	const client_redirect_uri = process.env.CLIENT_REDIRECT_URI!

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
						'&scope=' + encodeURIComponent(scopes) +
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

export class Spotify {
	api: SpotifyApi
	user: User

	static async make() {
		const api = await auth()
		const user = await api.currentUser.profile()

		console.log(`spotify: logged in as ${user.display_name}, ${user.id}`)

		const q = await db.schema.select({ count: sql<number>`count(*)` })
			.from(schema.thirdparty_spotify_users)
			.where(sql`spotify_id = ${user.id}`)
			.limit(1)

		if (q[0].count === 0) {
			await db.schema.insert(schema.thirdparty_spotify_users)
				.values({spotify_id: user.id})
		}

		return new Spotify(api, user)
	}

	

	// cache spotify liked songs using a watermark level and list of liked song ids
	async index_liked_songs() {
		const ini = await this.api.currentUser.tracks.savedTracks()

		const q = await db.schema.select({ count: sql<number>`count(*)` })
			.from(schema.thirdparty_spotify_saved_tracks)
			.where(sql`spotify_user_id = ${this.user.id}`)

		const db_count = q[0].count

		let offset = ini.total - db_count

		console.log(`spotify: user db: ${db_count}, amount: ${ini.total}, diff: ${offset}`)

		// iterate
		// start from the bottom and go up to using sighandlers to allow graceful exit

		async function cleanup() {
			const total = ini.total - offset

			console.log(`spotify: total ${total} tracks`)

			sigint_region_end()
		}

		sigint_region(async () => {
			await cleanup()
		})

		while (true) {
			let n_offset = offset <= 50 ? 0 : offset - 50

			const utc_millis = new Date().getTime()
			
			const k = await this.api.currentUser.tracks.savedTracks(50, n_offset)

			const for_db_tracks: Track[] = []
			const for_db_saved_tracks: (typeof schema.thirdparty_spotify_saved_tracks.$inferInsert)[] = []

			for (const v of k.items) {
				const track = v.track

				if (track.is_local) {
					console.log(`spotify: skipping local track ${track.name}, id: ${track.id}`)
					continue
				}

				// spotify provides ISO 8601 date strings
				const added_at_millis = new Date(v.added_at).getTime()

				for_db_tracks.push(track)

				for_db_saved_tracks.push({
					utc: added_at_millis,
					spotify_user_id: this.user.id,
					spotify_track_id: track.id,
				})
			}

			await db.append_spotify_v1_get_track(for_db_tracks, utc_millis)
			await db.schema.insert(schema.thirdparty_spotify_saved_tracks)
				.values(for_db_saved_tracks)
				.onConflictDoNothing()

			offset = n_offset

			if (offset == 0) {
				break
			}
		}

		await cleanup()
	}

	constructor(api: SpotifyApi, user: User) {
		this.api = api
		this.user = user
	}
}
