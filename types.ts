import * as schema from "./schema"

// stop polluting my namespace (it's not possible to import * as ...)
// spotify v1 api
import { Album, AudioFeatures, SimplifiedTrack, Track } from "@spotify/web-api-ts-sdk"

// {"name": "cosMo@Bousou-P", "locale": "en-US"}
// {"name": "cosMo@暴走P", "locale": "ja-JP"}
export type Locale = { name: string, locale?: string }

export type TrackId = number
export type AlbumId = number

export type ArtistId = number
export type MediaId = number

export type TrackEntry = typeof schema.track.$inferInsert
export type AlbumEntry = typeof schema.album.$inferInsert
export type ArtistEntry = typeof schema.artist.$inferInsert

export type SpotifyTrack = Track
export type SpotifyAlbum = Album
export type SpotifyAudioFeatures = AudioFeatures
export type SpotifyAlbumTrack = SimplifiedTrack[] // pagination unwrapped
export type SpotifyId = string
export type Isrc = string

export type TrackMetaId = number
export type AlbumMetaId = number

// ensure metadata is idempotent, storing no changing state
// deepEquals is used for comparison

// null means failed
type TrackMetaImpl =
	| { kind: 'name', meta: Locale } // 1 of each "locale" kind
	| { kind: 'isrc', meta: Isrc | null } // 1
	| { kind: 'spotify_id', meta: SpotifyId | null } // many
	| { kind: 'spotify_v1_get_track', meta: SpotifyTrack } // one of each spotify_id
	| { kind: 'spotify_v1_audio_features', meta: SpotifyAudioFeatures } // one of each spotify_id

export type TrackMeta = Omit<typeof schema.track_meta.$inferInsert, 'id' | 'track_id'> & TrackMetaImpl
export type TrackMetaEntry = typeof schema.track_meta.$inferInsert & TrackMetaImpl

// null means failed
export type AlbumMetaImpl =
	| { kind: 'name', meta: Locale } // 1 of each "locale" kind
	| { kind: 'isrc', meta: Isrc | null } // 1
	| { kind: 'spotify_id', meta: SpotifyId | null } // many
	| { kind: 'spotify_v1_get_album', meta: SpotifyAlbum } // one of each spotify_id
	| { kind: 'spotify_v1_get_album_track', meta: SpotifyAlbumTrack } // one of each spotify_id

export type AlbumMeta = Omit<typeof schema.album_meta.$inferInsert, 'id' | 'album_id'> & AlbumMetaImpl
export type AlbumMetaEntry = typeof schema.album_meta.$inferInsert & AlbumMetaImpl