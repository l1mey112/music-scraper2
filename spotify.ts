import { SpotifyApi, type AccessToken, type User, type Track } from '@spotify/web-api-ts-sdk';
import Database from 'bun:sqlite';
import { db } from './db';
import * as schema from './schema';
import type { TrackEntry } from './schema';
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

	async index_liked_songs() {
		const ini = await this.api.currentUser.tracks.savedTracks(1)
		let total = ini.total

		// incrementalism assumes that new songs are added to the top

		// TODO: currently scrapes to 50 incrementsm my 7235 songs go to 7250
		//       how does that even happen? what data is the extra songs?

		const db_count_q = await db.schema.select({ count: sql<number>`count(*)` })
			.from(schema.thirdparty_spotify_saved_tracks)
			.where(sql`spotify_user_id = ${this.user.id}`)
		const db_count = db_count_q[0].count

		total -= db_count

		let offset = 0

		while (offset < total) {
			const sp = safepoint('spotify.index_liked_songs.batch50')
			
			const utc_millis = new Date().getTime()

			const req = await this.api.currentUser.tracks.savedTracks(50, offset)

			const for_db_tracks: Track[] = []
			const for_db_saved_tracks: (typeof schema.thirdparty_spotify_saved_tracks.$inferInsert)[] = []

			for (const v of req.items) {
				const track = v.track

				if (track.is_local) {
					console.log(`spotify: skipping local track ${track.name}, id: ${track.id}`)
					continue
				}

				// spotify provides ISO 8601 date strings
				const save_at_millis = new Date(v.added_at).getTime()

				for_db_tracks.push(track)

				for_db_saved_tracks.push({
					save_utc: save_at_millis,
					spotify_user_id: this.user.id,
					spotify_track_id: track.id,
					isrc: track.external_ids?.isrc,
				})
			}

			await db.append_spotify_v1_get_track(for_db_tracks, utc_millis)
			await db.schema.insert(schema.thirdparty_spotify_saved_tracks)
				.values(for_db_saved_tracks)
				.onConflictDoNothing()

			offset += 50

			sp.release()
		}
	}

	constructor(api: SpotifyApi, user: User) {
		this.api = api
		this.user = user
	}
}
