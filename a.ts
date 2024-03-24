import ytdl from "ytdl-core";
import fs from "fs";

import { Readable } from "stream";
import { youtube_cookie_header, youtube_music, youtube_music_create } from "./youtube";

// DO NOT TRUST YOUTUBE IDS FOR NOW

// Nsg7z0890HU isn't right, compare names and durations
// is a jp name which means check if it matches with youtube and spotify together

// some of these except for the last one are just plain wrong...
await youtube_music_create()

// const g = await youtube_music.getSong('Nsg7z0890HU')
// const g = await youtube_music.searchSongs('ヘブンドープ 煮ル果実')

// const g = await youtube_music.getSong('9LxlDjbvF6Q')
const g = await youtube_music.getSong('bsTOYb7a8is')

console.log(g)

// https://github.com/fent/node-ytdl-core/issues/659
// seriously?
// in `exports.checkForUpdates` it checks for updates and fucking dies??
// useless shit
/* const k = ytdl('bsTOYb7a8is', { filter: "audioonly", highWaterMark: 1 << 25, dlChunkSize : 1024 * 1024, quality: "highestaudio" })

console.log(k)

const t = Bun.file('bsTOYb7a8is.mp3')

const components = []
for await (const chunk of k) {
	components.push(chunk)
}

Bun.write(t, components) */


// const k = ytdl('bsTOYb7a8is', { filter: "audioonly", highWaterMark: 1 << 25, dlChunkSize : 1024 * 1024, quality: "highestaudio" })


/* await youtube_music_create()


const info = await ytdl.getInfo('bsTOYb7a8is', {
	requestOptions: {
		Headers: {
			"User-Agent": "Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/2.2 Chrome/63.0.3239.84 TV Safari/537.36",
		}
	}
})

const f = Bun.file('bsTOYb7a8is.mp3')

const fmt = ytdl.chooseFormat(info.formats, { filter: "audioonly", quality: "highestaudio" })
const r = ytdl.downloadFromInfo(info, { filter: "audioonly", highWaterMark: 1 << 25, dlChunkSize : 1024 * 1024, quality: "highestaudio" })

console.log(fmt.mimeType)

const components = []
for await (const chunk of r) {
	components.push(chunk)
}

Bun.write(f, components) */