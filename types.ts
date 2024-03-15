import * as schema from "./schema"

// stop polluting my namespace (it's not possible to import * as ...)
// spotify v1 api
import { Album, AudioFeatures, SimplifiedTrack, Track } from "@spotify/web-api-ts-sdk"

// {'default': 'cosMo@Bousou-P', 'ja-JP': 'cosMo@暴走P'}
// TODO: not currently used
export type Locale = {
	[locale: string]: string
}

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
export type TrackMetaSource = keyof TrackMetaImpl // 'isrc' | 'spotify_id' | 'spotify_v1_get_track' | 'spotify_v1_audio_features' // ... | 'youtube' | 'niconico' | 'soundcloud' | 'bandcamp'
export type TrackMetaImpl = {
	isrc: Isrc,
	spotify_id: SpotifyId,
	spotify_v1_get_track: SpotifyTrack,
	spotify_v1_audio_features: SpotifyAudioFeatures,
}

export type TrackMeta<T extends TrackMetaSource> = Omit<TrackMetaEntry<T>, 'id' | 'track_id'>
export type TrackMetaEntry<T extends TrackMetaSource> = typeof schema.track_meta.$inferInsert & {
	kind: T
	meta: TrackMetaImpl[T] | null
}

export type AlbumMetaId = number
export type AlbumMetaSource = keyof AlbumMetaImpl
export type AlbumMetaImpl = {
	isrc: Isrc,
	spotify_id: SpotifyId,
	spotify_v1_get_album: SpotifyAlbum,
	spotify_v1_get_album_track: SpotifyAlbumTrack,
}

export type AlbumMetaEntry<T extends AlbumMetaSource> = typeof schema.album_meta.$inferInsert & {
    kind: T
	meta: AlbumMetaImpl[T] | null
}