import YTMusic from "ytmusic-api"

export let youtube_music: YTMusic
export const youtube_cookie_header: string = process.env.YOUTUBE_COOKIE_HEADER!

if (!youtube_cookie_header) {
	console.error(`missing youtube_cookie_header`)
	process.exit(1)
}

// may need to do more here in the future
export async function youtube_music_create() {
	youtube_music = new YTMusic()
	await youtube_music.initialize()
	console.log(`youtube_music: created api instance`)
}

export async function youtube_dl_create() {
	// nothing
}
