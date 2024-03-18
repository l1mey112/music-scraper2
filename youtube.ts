import YTMusic from "ytmusic-api"

export let youtube_music: YTMusic

// may need to do more here in the future
export async function youtube_music_create() {
	youtube_music = new YTMusic()
	await youtube_music.initialize()

	console.log(`youtube_music: created api instance`)
}
