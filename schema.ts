import { sqliteTable, integer, text, unique } from "drizzle-orm/sqlite-core";
import { Locale, TrackId, AlbumId, ArtistId, SpotifyTrack, Isrc, SpotifyId, SpotifyAudioFeatures, SpotifyAlbum, SpotifyArtist, QobuzId, QobuzTrack, DeezerId, DeezerTrack, YoutubeId } from "./types";

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

export const artist = sqliteTable('artist', {
	id: integer('id').$type<ArtistId>().primaryKey(),

	name: text('name').notNull(),

	meta_spotify_id: text('meta_spotify_id').$type<SpotifyId>(),
	meta_spotify_v1_get_artist: text('meta_spotify_v1_get_artist', { mode: 'json' }).$type<SpotifyArtist>(),
})

export const track_artists = sqliteTable('track_artists', {
	track_id: integer('track_id').references(() => track.id).$type<TrackId>(),
	artist_id: integer('artist_id').references(() => artist.id).$type<ArtistId>(),
	is_first: integer('is_first', { mode: "boolean" }).notNull(),
}, (t) => ({
	unq: unique().on(t.track_id, t.artist_id),
}))

// pass backoff for metadata
export const pass_backoff = sqliteTable('pass_backoff', {
	utc: integer('utc').notNull(),

	// one of these should be not null
	track_id: integer('track_id').references(() => track.id),
	album_id: integer('album_id').references(() => album.id),
	artist_id: integer('artist_id').references(() => artist.id),

	pass: text('pass').notNull(),
})

// TODO: user defined metadata using a type, which is the closest ground truth

//type TrackMetaSource = 'spotify_v1_get_track' | 'spotify_v1_audio_features' // ... | 'youtube' | 'niconico' | 'soundcloud' | 'bandcamp'

/* export const media = sqliteTable('media', {
	id: integer('id').$type<MediaId>().primaryKey(),

	utc: integer('utc').notNull(), // utc epoch milliseconds

	data: text('data', { mode: 'json' }).$type<MediaEntry>().notNull(),
});

type MediaImpl = {
	cover_art: {
		mime: string | null;
		url: string | null;
		local_path: string | null;
	}
}

type MediaKind = 'cover_art' // ... | 'closed_caption' | 'lyrics' | 'music_video'

export type MediaEntry = {
	[K in MediaKind]: {
		src: K;
		data: MediaImpl[K] | null; // null means failed
	};
}[MediaKind] */

// user accounts that need to be tracked incrementally to keep up with changes to append to database

export const thirdparty_spotify_users = sqliteTable('thirdparty:spotify_users', {
	spotify_id: text('spotify_id').primaryKey(),
})

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
export const thirdparty_store = sqliteTable('thirdparty:store', {
	kind: text('kind').notNull(),
	data: text('data', { mode: 'json' }).notNull(),
})
