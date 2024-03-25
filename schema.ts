import { sqliteTable, integer, text, unique } from "drizzle-orm/sqlite-core";
import { Locale, TrackId, AlbumId, ArtistId, SpotifyTrack, Isrc, SpotifyId, SpotifyAudioFeatures, SpotifyAlbum, SpotifyArtist, QobuzId, QobuzTrack, DeezerId, DeezerTrack, YoutubeId, MediaKind } from "./types";

// https://www.sqlite.org/withoutrowid.html
// drizzle doesn't support without rowid, so we do postprocess with python script

// WITHOUT-ROWID: track
export const track = sqliteTable('track', {
	id: integer('id').$type<TrackId>().primaryKey(),

	name: text('name').notNull(),
	// locale: text('locale', { mode: 'json' }).$type<Locale>(),

	album_id: integer('album_id').references(() => album.id).$type<AlbumId>(), // check null first to use `track_number` and `disc_number`
	album_track_number: integer('album_track_number').$default(() => 0).notNull(), // 1 index based
	album_disc_number: integer('album_disc_number').$default(() => 0).notNull(), // 1 index based

	meta_isrc: text('meta_isrc').$type<Isrc>(),
	meta_youtube_music_id: text('meta_youtube_music_id').$type<YoutubeId>(),
	meta_duration_ms: integer('meta_duration_ms'),
	meta_deezer_id: integer('meta_deezer_id').$type<DeezerId>(),
	meta_deezer_get_track: text('meta_deezer_get_track', { mode: 'json' }).$type<DeezerTrack>(),
	meta_qobuz_id: integer('meta_qobuz_id').$type<QobuzId>(),
	meta_qobuz_get_track: text('meta_qobuz_get_track', { mode: 'json' }).$type<QobuzTrack>(),
	meta_spotify_id: text('meta_spotify_id').$type<SpotifyId>(),
	meta_spotify_v1_get_track: text('meta_spotify_v1_get_track', { mode: 'json' }).$type<SpotifyTrack>(),
	meta_spotify_v1_audio_features: text('meta_spotify_v1_audio_features', { mode: 'json' }).$type<SpotifyAudioFeatures>(),
})

// WITHOUT-ROWID: album
export const album = sqliteTable('album', {
	id: integer('id').$type<AlbumId>().primaryKey(),

	name: text('name').notNull(),
	// locale: text('locale', { mode: 'json' }).$type<Locale>(),

	// find artist of album, select first track then first artist (eariest order in joining table)
	total_tracks: integer('total_tracks'),

	meta_isrc: text('meta_isrc').$type<Isrc>(),
	meta_spotify_id: text('meta_spotify_id').$type<SpotifyId>(),
	meta_spotify_v1_get_album: text('meta_spotify_v1_get_album', { mode: 'json' }).$type<SpotifyAlbum>(),
})

// WITHOUT-ROWID: artist
export const artist = sqliteTable('artist', {
	id: integer('id').$type<ArtistId>().primaryKey(),

	name: text('name').notNull(),

	meta_spotify_id: text('meta_spotify_id').$type<SpotifyId>(),
	meta_spotify_v1_get_artist: text('meta_spotify_v1_get_artist', { mode: 'json' }).$type<SpotifyArtist>(),
})

// does the order matter?
// cannot have WITHOUT-ROWID as no primary key exists
export const track_artists = sqliteTable('track_artists', {
	track_id: integer('track_id').references(() => track.id).$type<TrackId>(),
	artist_id: integer('artist_id').references(() => artist.id).$type<ArtistId>(),
	is_first: integer('is_first', { mode: "boolean" }).notNull(),
}, (t) => ({
	unq: unique().on(t.track_id, t.artist_id),
}))

// pass backoff for metadata
// WITHOUT-ROWID: pass_backoff
export const pass_backoff = sqliteTable('pass_backoff', {
	utc: integer('utc').primaryKey(),

	// one of these should be not null
	track_id: integer('track_id').references(() => track.id),
	album_id: integer('album_id').references(() => album.id),
	artist_id: integer('artist_id').references(() => artist.id),

	pass: text('pass').notNull(),
})

// media on disk
export const media_fs = sqliteTable('media_fs', {
	// db    | uJMnZPHUkDtuz6KYOPHDS.jpg
	// hash  | uJMnZPHUkDtuz6KYOPHDS
	// shard | uJ
	// path  | uJ / MnZPHUkDtuz6KYOPHDS.jpg

	// hash with file extension
	hash: text('hash').primaryKey(),

	// one of these should be not null
	track_id: integer('track_id').references(() => track.id),
	album_id: integer('album_id').references(() => album.id),
	artist_id: integer('artist_id').references(() => artist.id),

	kind: text('kind').$type<MediaKind>().notNull(),
})

// user accounts that need to be tracked incrementally to keep up with changes to append to database
// WITHOUT-ROWID: thirdparty:spotify_users
export const thirdparty_spotify_users = sqliteTable('thirdparty:spotify_users', {
	spotify_id: text('spotify_id').primaryKey(),
})

// WITHOUT-ROWID: thirdparty:spotify_users
export const thirdparty_spotify_saved_tracks = sqliteTable('thirdparty:spotify_saved_tracks', {
	id: integer('id').primaryKey(),
	save_utc: integer('utc').notNull(), // utc epoch milliseconds
	spotify_user_id: text('spotify_user_id').notNull().references(() => thirdparty_spotify_users.spotify_id),
	track_id: integer('track_id').notNull().references(() => track.id),
}, (t) => ({
	// a user can save multiple of the same underlying track at different times
	unq: unique().on(t.spotify_user_id, t.track_id, t.save_utc),
}))

// persistent store
// WITHOUT-ROWID: thirdparty:store
export const thirdparty_store = sqliteTable('thirdparty:store', {
	kind: text('kind').primaryKey(),
	data: text('data', { mode: 'json' }).notNull(),
})
