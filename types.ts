import * as schema from "./schema"

// stop polluting my namespace (it's not possible to import * as ...)
// spotify v1 api
import { Album, Artist, AudioFeatures, SimplifiedTrack, Track } from "@spotify/web-api-ts-sdk"

// {"name": "cosMo@Bousou-P"}
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
export type SpotifyAudioFeatures = AudioFeatures
export type SpotifyAlbum = Omit<Album, 'tracks'> // trim the fat
export type SpotifyAlbumTrack = SimplifiedTrack[] // pagination unwrapped
export type SpotifyArtist = Artist
export type SpotifyId = string
export type QobuzId = number
export type Isrc = string