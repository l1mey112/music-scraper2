import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

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

	utc: integer('utc').notNull(), // utc epoch seconds

	artist_primary_id: integer('artist_primary_id').$type<ArtistId>().notNull(),
	artist_ids: text('artists', { mode: 'json' }).$type<ArtistId[]>().notNull(), // ArtistId[]

	album_id: integer('album_id').$type<AlbumId>().notNull(),
	album_track_number: integer('album_track_number').notNull(), // 1 index based

	meta: text('meta', { mode: 'json' }).$type<TrackMeta>().notNull(),
});

export const album = sqliteTable('album', {
	id: integer('id').$type<AlbumId>().primaryKey(),

	name: text('name').notNull(),
	name_locale: text('name_locale', { mode: 'json' }).$type<Locale>().notNull(),

	utc: integer('utc').notNull(), // utc epoch seconds

	artist_primary_id: integer('artist_primary_id').$type<ArtistId>().notNull(),
	artist_ids: text('artists', { mode: 'json' }).$type<ArtistId[]>().notNull(), // ArtistId[]

	meta: text('meta', { mode: 'json' }).$type<AlbumMeta>().notNull(),
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
		utc: number; // utc epoch seconds
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
		utc: number; // utc epoch seconds
		data: AlbumMetaImpl[K] | null; // null means failed
	};
}[AlbumMetaSource]

export const media = sqliteTable('media', {
	id: integer('id').$type<MediaId>().primaryKey(),

	utc: integer('utc').notNull(), // utc epoch seconds

	data: text('data', { mode: 'json' }).$type<MediaEntry>().notNull(),
});

type MediaImpl = {
	cover_art: {
		mime: string | null;
		url: string | null;
		local_path: string | null;
	}
	n: string
}

type MediaKind = 'cover_art' | 'n' // ... | 'closed_caption' | 'lyrics' | 'music_video'

export type MediaEntry = {
	[K in MediaKind]: {
		src: K;
		data: MediaImpl[K] | null; // null means failed
	};
}[MediaKind]
