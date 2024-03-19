import ytdl from "ytdl-core";
import fs from "fs";

import { Readable } from "stream";

// DO NOT TRUST YOUTUBE IDS FOR NOW

// Nsg7z0890HU isn't right, compare names and durations
// is a jp name which means check if it matches with youtube and spotify together

// some of these except for the last one are just plain wrong...
/* await youtube_music_create()

// const g = await youtube_music.getSong('Nsg7z0890HU')
// const g = await youtube_music.searchSongs('ヘブンドープ 煮ル果実')

// const g = await youtube_music.getSong('9LxlDjbvF6Q')
const g = await youtube_music.getSong('bsTOYb7a8is')

console.log(g) */

/* const k = await ytdl('bsTOYb7a8is', { filter: "audioonly" })

const t = Bun.file('bsTOYb7a8is.mp3')
for await (const chunk of k) {
	Bun.write(t, chunk)
} */

const k = Bun.file("test")
await Bun.write(k, "test")
await Bun.write(k, "test")
await Bun.write(k, "test")