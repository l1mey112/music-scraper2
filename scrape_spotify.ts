export type SpotifyImage = {
	height: number
	url: string
	width: number
}

export type SpotifyCopyright = {
	text: string
	type: string
}

export type SpotifyArtistInitialData = {
	followers: number
	monthly_listeners: number
	avatar_extracted_colour_dark?: string // hex
	avatar_extracted_colour_raw?: string // hex
	external_links: string[]
	biography: string
}

interface RawArtistInitialData {
	entities: {
		items: {
			[key: string]: {
				profile: {
					biography: {
						text: string
					}
					externalLinks: {
						items: {
							// name: string
							url: string
						}[]
					}
					// name: string
				}
				stats: {
					followers: number
					monthlyListeners: number
				}
				visuals: {
					avatarImage: {
						extractedColors: {
							colorDark?: {
								hex: string
							}
							colorRaw?: {
								hex: string
							}
						}
						sources: SpotifyImage[]
					}
					headerImage: {
						sources: SpotifyImage[]
					}
				}
			}
		}
	}
}

export type SpotifyTrackInitialData = {
	copyright: SpotifyCopyright[]
}

interface RawTrackInitialData {
	entities: {
		items: {
			[key: string]: {
				albumOfTrack: {
					copyright: {
						items: SpotifyCopyright[]
					}
				}
			}
		}
	}
}

export type SpotifyAlbumInitialData = {
	cover_extracted_colour_dark?: string // hex
	cover_extracted_colour_raw?: string // hex
}

interface RawAlbumInitialData {
	entities: {
		items: {
			[key: string]: {
				coverArt: {
					extractedColors: {
						colorDark?: {
							hex: string
						}
						colorRaw?: {
							hex: string
						}
					}
				}
			}
		}
	}
}

// initial data stores basically everything we need, but the gallery images at the bottom where the biography is
// it would be nice to have them, but it's not a priority

async function scrape_spotify_artist_initial_data(spotify_id: string): Promise<SpotifyArtistInitialData | null> {
	const url = `https://open.spotify.com/artist/${spotify_id}`
	const response = await fetch(url)
	const text = await response.text()
	const match = text.match(/<script\s+id="initial-state"\s+type="text\/plain">([^<]+)<\/script>/)
	if (!match) {
		console.error(`scrape_spotify_artist_initial_data: warn failed to match initial data for spotify_id ${spotify_id}`)
		return null
	}

	const data: RawArtistInitialData = JSON.parse(Buffer.from(match[1], 'base64').toString('utf-8'))
	const qn = `spotify:artist:${spotify_id}`

	let ret: SpotifyArtistInitialData
	try {
		ret = {
			followers: data.entities.items[qn].stats.followers,
			monthly_listeners: data.entities.items[qn].stats.monthlyListeners,
			avatar_extracted_colour_dark: data.entities.items[qn].visuals.avatarImage.extractedColors.colorDark?.hex,
			avatar_extracted_colour_raw: data.entities.items[qn].visuals.avatarImage.extractedColors.colorRaw?.hex,
			external_links: data.entities.items[qn].profile.externalLinks.items.map(v => v.url),
			biography: data.entities.items[qn].profile.biography.text,
		}
	} catch {
		console.error(`scrape_spotify_artist_initial_data: warn failed to parse initial data for spotify_id ${spotify_id}`)
		return null
	}

	return ret
}

async function scrape_spotify_track_initial_data(spotify_id: string): Promise<SpotifyTrackInitialData | null> {
	const url = `https://open.spotify.com/track/${spotify_id}`
	const response = await fetch(url)
	const text = await response.text()
	const match = text.match(/<script\s+id="initial-state"\s+type="text\/plain">([^<]+)<\/script>/)
	if (!match) {
		console.error(`scrape_spotify_track_initial_data: warn failed to match initial data for spotify_id ${spotify_id}`)
		return null
	}

	const data: RawTrackInitialData = JSON.parse(Buffer.from(match[1], 'base64').toString('utf-8'))
	const qn = `spotify:track:${spotify_id}`

	let ret: SpotifyTrackInitialData
	try {
		ret = {
			copyright: data.entities.items[qn].albumOfTrack.copyright.items,
		}
	} catch {
		console.error(`scrape_spotify_track_initial_data: warn failed to parse initial data for spotify_id ${spotify_id}`)
		return null
	}

	return ret
}

async function scrape_spotify_album_initial_data(spotify_id: string): Promise<SpotifyAlbumInitialData | null> {
	const url = `https://open.spotify.com/album/${spotify_id}`
	const response = await fetch(url)
	const text = await response.text()
	const match = text.match(/<script\s+id="initial-state"\s+type="text\/plain">([^<]+)<\/script>/)
	if (!match) {
		console.error(`scrape_spotify_album_initial_data: warn failed to match initial data for spotify_id ${spotify_id}`)
		return null
	}

	const data: RawAlbumInitialData = JSON.parse(Buffer.from(match[1], 'base64').toString('utf-8'))
	const qn = `spotify:album:${spotify_id}`

	let ret: SpotifyAlbumInitialData
	try {
		ret = {
			cover_extracted_colour_dark: data.entities.items[qn].coverArt.extractedColors.colorDark?.hex,
			cover_extracted_colour_raw: data.entities.items[qn].coverArt.extractedColors.colorRaw?.hex,
		}
	} catch {
		console.error(`scrape_spotify_album_initial_data: warn failed to parse initial data for spotify_id ${spotify_id}`)
		return null
	}

	return ret
}

// TODO: create passes, use a request pool to run many of these at once
