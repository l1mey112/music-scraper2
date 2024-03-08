import { sqliteTable, integer, text, unique } from "drizzle-orm/sqlite-core";

// stop polluting my namespace
// spotify v1 api
import type { Track, AudioFeatures, Album } from "@spotify/web-api-ts-sdk";

// {'default': 'cosMo@Bousou-P', 'ja-JP': 'cosMo@暴走P'}
export type Locale = {
	[locale: string]: string;
}

export type TrackId = number;
export type AlbumId = number;
export type ArtistId = number;
export type MediaId = number;

export const track = sqliteTable('track', {
	id: integer('id').$type<TrackId>().primaryKey(),

	name: text('name').notNull(),
	name_locale: text('name_locale', { mode: 'json' }).$type<Locale>().notNull(),

	utc: integer('utc').notNull(), // utc epoch milliseconds

	// possibly null, meaning no artists yet
	// can extrapolate artists based on existing metadata
	artist_primary_id: integer('artist_primary_id').$type<ArtistId>(),
	artist_ids: text('artists', { mode: 'json' }).$type<ArtistId[]>(), // ArtistId[]

	// possibly null, meaning no album yet
	// can extrapolate albums based on existing metadata
	album_id: integer('album_id').$type<AlbumId>(),
	album_track_number: integer('album_track_number'), // 1 index based
	album_disc_number: integer('album_disc_number'), // 1 index based

	meta: text('meta', { mode: 'json' }).$type<TrackMeta[]>().notNull(),
	meta_spotify_id: text('meta_spotify_id').notNull(),
});

// TODO: fuckers colliding with Track
export type TrackEntry = typeof track.$inferInsert

export const album = sqliteTable('album', {
	id: integer('id').$type<AlbumId>().primaryKey(),

	name: text('name').notNull(),
	name_locale: text('name_locale', { mode: 'json' }).$type<Locale>().notNull(),

	utc: integer('utc').notNull(), // utc epoch milliseconds

	// possibly null, meaning no artists yet
	// can extrapolate artists based on existing metadata
	artist_primary_id: integer('artist_primary_id').$type<ArtistId>(),
	artist_ids: text('artists', { mode: 'json' }).$type<ArtistId[]>(), // ArtistId[]

	meta: text('meta', { mode: 'json' }).$type<AlbumMeta[]>().notNull(),
	meta_spotify_id: text('meta_spotify_id').unique(),

	// uniqueness is only checked on non null arguments?
	// https://sqlite.org/faq.html#q26
});

// TODO: user defined metadata using a type, which is the closest ground truth

// use `never` for unimplemented sources
type TrackMetaImpl = {
	spotify_v1_get_track: Track,
	spotify_v1_audio_features: AudioFeatures,
	// youtube: never,
}

type TrackMetaSource = 'spotify_v1_get_track' | 'spotify_v1_audio_features' // ... | 'youtube' | 'niconico' | 'soundcloud' | 'bandcamp'

export type TrackMeta = {
	[K in TrackMetaSource]: {
		src: K;
		utc: number; // utc epoch milliseconds
		data: TrackMetaImpl[K] | null; // null means failed
	};
}[TrackMetaSource]

type AlbumMetaImpl = {
	// spotify album returns track list as a paginated API chain
	// it's nice to store, but we can't read track list from album
	spotify_v1_get_album: Album,
	// youtube: never,
}

type AlbumMetaSource = 'spotify_v1_get_album' // ... | 'youtube' | 'niconico' | 'soundcloud' | 'bandcamp'

export type AlbumMeta = {
	[K in AlbumMetaSource]: {
		src: K;
		utc: number; // utc epoch milliseconds
		data: AlbumMetaImpl[K] | null; // null means failed
	};
}[AlbumMetaSource]

export const media = sqliteTable('media', {
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
}[MediaKind]

// user accounts that need to be tracked incrementally to keep up with changes to append to database

export const thirdparty_spotify_users = sqliteTable('thirdparty:spotify_users', {
	spotify_id: text('spotify_id').primaryKey(),
})

export const thirdparty_spotify_saved_tracks = sqliteTable('thirdparty:spotify_saved_tracks', {
	id: integer('id').primaryKey(),
	utc: integer('utc').notNull(), // utc epoch milliseconds
	spotify_user_id: text('spotify_user_id').notNull().references(() => thirdparty_spotify_users.spotify_id),
	spotify_track_id: text('spotify_track_id').notNull(),
}, (t) => ({
	unq: unique().on(t.spotify_user_id, t.spotify_track_id),
}))
