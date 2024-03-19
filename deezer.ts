// deezer-api and deezer-api-ts are so fucking old
// reverse engineering deezer-py instead

import { BunFile } from "bun"
import { DeezerId } from "./types"
import makeFetchCookie from 'fetch-cookie'
import { Blowfish } from "egoroof-blowfish"

export const deezer_arl = process.env.DEEZER_ARL!

if (!deezer_arl) {
	console.error('missing deezer arl')
	process.exit(1)
}

// class API
// will return undefined on status 800 no data
export async function deezer_api_json(method: string): Promise<any | undefined> {
	const k = await fetch(`https://api.deezer.com/${method}`, {
		method: "GET",
		headers: {
			"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:64.0) Gecko/20100101 Firefox/64.0",
			"Cookie": `arl=${deezer_arl}; Domain=.deezer.com; Path=/; HttpOnly`,
		},
	})

	if (!k.ok) {
		console.error(`deezer_api_json: request status non 200: ${k.status} ${await k.text()}`)
		process.exit(1)
	}

	const result_json: any = await k.json()

	// thanks LLM
	if ('error' in result_json) {
		if ('code' in result_json.error) {
			if ([4, 700].includes(result_json.error.code)) {
				await Bun.sleep(5000)
				return await deezer_api_json(method)
			}
			if (result_json.error.code === 100) {
				console.error(`deezer_api_json: ItemsLimitExceeded: ${method} ${result_json.error.message ?? ''}`);
				process.exit(1)
			}
			if (result_json.error.code === 200) {
				console.error(`deezer_api_json: Permission: ${method} ${result_json.error.message ?? ''}`);
				process.exit(1)
			}
			if (result_json.error.code === 300) {
				console.error(`deezer_api_json: InvalidToken: ${method} ${result_json.error.message ?? ''}`);
				process.exit(1)
			}
			if (result_json.error.code === 500) {
				console.error(`deezer_api_json: Parameter: ${method} ${result_json.error.message ?? ''}`);
				process.exit(1)
			}
			if (result_json.error.code === 501) {
				console.error(`deezer_api_json: MissingParameter: ${method} ${result_json.error.message ?? ''}`);
				process.exit(1)
			}
			if (result_json.error.code === 600) {
				console.error(`deezer_api_json: InvalidQuery: ${method} ${result_json.error.message ?? ''}`);
				process.exit(1)
			}
			if (result_json.error.code === 800) {
				// console.error(`deezer_api_json: Data: ${method} ${result_json.error.message ?? ''}`);
				// no data
				return undefined
			}
			if (result_json.error.code === 901) {
				console.error(`deezer_api_json: IndividualAccountChangedNotAllowed: ${method} ${result_json.error.message ?? ''}`);
				process.exit(1)
			}
		}
		console.error(`deezer_api_json: ApiError(unhandled): ${method} ${JSON.stringify(result_json.error)}`);
		process.exit(1)
	}

	return result_json
}

// need to persist CRSF cookies
const jar = new makeFetchCookie.toughCookie.CookieJar()
const gw_fetch = makeFetchCookie(fetch, jar)

// use dot notation, example `deezer.getUserData`
// class GW
// result_json['results']['checkForm'] is the api token
export async function deezer_gw_json(method: string, args: { [key: string]: string } = {}, params: { [key: string]: string } = {}): Promise<any> {
	const p = {
		api_version: '1.0',
		api_token: method == 'deezer.getUserData' ? 'null' : deezer_gw_api_key,
		input: '3',
		method: method,
		...params
	}

	const url = new URL("http://www.deezer.com/ajax/gw-light.php");
	url.search = new URLSearchParams(p).toString();

	console.log(url.toString())

	try {
		const response = await gw_fetch(url.toString(), {
			method: 'POST',
			body: JSON.stringify(args),
			headers: {
				"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.130 Safari/537.36",
				"Content-Type": "application/json",
			},
		});
		const result_json: any = await response.json();
		if (Object.keys(result_json.error).length > 0) {
			if ("VALID_TOKEN_REQUIRED" in result_json.error) {
				console.error(`deezer_gw_json: api error ${method} VALID_TOKEN_REQUIRED, refreshing token`)
				await deezer_gw_cookie()
				return deezer_gw_json(method, args, params)
			}
			console.error(`deezer_gw_json: api error ${method} ${JSON.stringify(result_json.error)}`);
			process.exit(1)
			// can try fallbacks, but whatever
		}
		return result_json.results;
	} catch (error) {
		console.error(`deezer_gw_json: api error unhandled ${method} ${error}`);
		process.exit(1);
	}
}

enum FailKind {
	NoData,
	Geolocation,
	Unhandled,
}

// type DeezerMediaUrl = { encrypted_params: { track_id: string, }, url: string }

async function deezer_get_track_url(track_token: string, track_format: string): Promise<string | FailKind> {
	const body = {
		license_token: deezer_current_user.license_token,
		media: [
			{
				type: "FULL",
				formats: [
					{ cipher: "BF_CBC_STRIPE", format: track_format },
				],
			}
		],
		track_tokens: [track_token],
	}

	const response = await fetch("https://media.deezer.com/v1/get_url", {
		method: 'POST',
		body: JSON.stringify(body),
		headers: {
			"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:64.0) Gecko/20100101 Firefox/64.0",
			"Cookie": `arl=${deezer_arl}; Domain=.deezer.com; Path=/; HttpOnly`,
			"Content-Type": "application/json",
		}
	})

	const ret: any = await response.json()

	if (Object.keys(ret).length === 0) {
		console.error(`deezer_get_track_url: no data for track token ${track_token}`)
		return FailKind.NoData
	}

	const result = []

	for (const data of ret.data) {
		if (data.errors) {
			if (data.errors[0].code === 2002) {
				console.error(`deezer_get_track_url: wrong geolocation for track token ${track_token} ${data.errors[0]}`)
				return FailKind.Geolocation
			} else {
				console.error(`deezer_get_track_url: unhandled error for track token ${track_token} ${data.errors[0]}`)
				return FailKind.Unhandled
			}
		}
		if (data.media && Object.keys(data.media).length > 0) {
			result.push(data.media[0]['sources'][0]['url'])
		}
	}

	if (result.length != 1) {
		console.error(`deezer_get_track_url: expected 1 url, got ${result.length} for track token ${track_token}`)
		console.error(`deezer_get_track_url: this shouldn't happen`)
		console.error(`deezer_downloadable_q2: should get encrypted url and decrypt it`)
		process.exit(1)
	}

	return result[0]
}

export async function deezer_downloadable_q2(id: DeezerId, file: BunFile): Promise<boolean> {
	// using streamrip quality 2 because we can (and checked)
	const quality = 1

	const quality_map: [number, string][] = [
		[9, "MP3_128"],  // quality 0
		[3, "MP3_320"],  // quality 1
		[1, "FLAC"],     // quality 2
	]

	const track_info = await deezer_gw_json('song.getData', { 'SNG_ID': `${id}` })

	const [_, format_str] = quality_map[quality]
	const fallback_id = (track_info['FALLBACK_ID'] ?? {}).SNG_ID

	/* const dl_info = {
		quality: quality,
		id: id,
		quality_to_size: quality_map.map(format => Number(track_info[`FILESIZE_${format[1]}`] ?? 0)),
	} */

	const track_token = track_info.TRACK_TOKEN
	const url = await deezer_get_track_url(track_token, format_str)

	if (url === FailKind.Geolocation && fallback_id) {
		console.error(`deezer_downloadable_q2: retrying with fallback id ${fallback_id} for track token ${track_token} (Geolocation)`)
		return deezer_downloadable_q2(fallback_id, file)
	} else if (typeof url === 'number') {
		console.error(`deezer_downloadable_q2: failed to get url for track token ${track_token} (FailKind: ${url})`)
		return false
	}

	const is_encrypted = url.match(/\/m(?:obile|edia)\//) ? true : false

	const response = await fetch(url, {
		method: 'GET',
		headers: {
			"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:64.0) Gecko/20100101 Firefox/64.0",
			"Cookie": `arl=${deezer_arl}; Domain=.deezer.com; Path=/; HttpOnly`,
		}
	})

	if (!response.ok || response.body === null) {
		console.error(`deezer_downloadable_q2: request status non 200 or body null: ${response.status} ${await response.text()}`)
		return false
	}

	if (!is_encrypted) {
		console.log(`deezer_downloadable_q2: deezer track ${id} is not encrypted, writing to file`)
		await Bun.write(file, response)
		return true
	}

	const blowfish_key = _generate_blowfish_key(`${id}`)

	const bf = new Blowfish(blowfish_key, Blowfish.MODE.CBC, Blowfish.PADDING.NULL)
	bf.setIv(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]))

	console.log(`deezer_downloadable_q2: deezer track ${id} is encrypted, decrypting with blowfish key ${blowfish_key}`)

	const chunk_size = 2048 * 3

	/* const all = []
	for await (const chunk of response.body) {
		all.push(chunk)
	}
	const buffer = Buffer.concat(all) */
	const buffer = new Uint8Array(await response.arrayBuffer())

	const decrypted_chunks = []
	for (let i = 0; i < buffer.length; i += chunk_size) {
		const data = buffer.subarray(i, Math.min(i + chunk_size, buffer.length))
		let decrypted_chunk
		if (data.length >= 2048) {
			decrypted_chunk = Buffer.concat([
				bf.decode(data.subarray(0, 2048), Blowfish.TYPE.UINT8_ARRAY),
				data.subarray(2048)
			])
		} else {
			decrypted_chunk = data
		}

		decrypted_chunks.push(decrypted_chunk)
	}

	await Bun.write(file, decrypted_chunks)
	return true
}

const BLOWFISH_SECRET = new Uint8Array(Buffer.from("g4el58wc0zvf9na1", "utf8"))

function _generate_blowfish_key(track_id: string): Uint8Array {
	// md5 hexdigest
	const hasher = new Bun.CryptoHasher("md5")
	hasher.update(Buffer.from(track_id, "utf8"))

	const hash = Buffer.from(hasher.digest("hex"), "utf8")
	const key = new Uint8Array(16)

	for (let i = 0; i < 16; i++) {
		key[i] = hash[i] ^ hash[i + 16] ^ BLOWFISH_SECRET[i]
	}

	return key
}

export let deezer_gw_api_key: string
export let deezer_current_user: any

async function deezer_gw_cookie() {
	const user_data = await deezer_gw_json('deezer.getUserData')
	deezer_gw_api_key = user_data.checkForm
}

async function deezer_gw_create() {
	await deezer_gw_cookie()
	await jar.setCookie(`arl=${deezer_arl}; Domain=.deezer.com; Path=/; HttpOnly`, 'http://www.deezer.com/ajax/gw-light.php')
	console.log(`deezer: created gw instance`)
}

export async function deezer_create() {
	// TODO: if we ever need to use the gw api, its there
	//       gw does allow us to get lyrics
	//       https://stackoverflow.com/questions/42165724/how-to-get-lyrics-from-the-deezer-api

	await deezer_gw_create()
	const user_data = await deezer_gw_json('deezer.getUserData')

	// if no keys
	if (Object.keys(user_data).length === 0) {
		console.error('deezer: no user data')
		process.exit(1)
	}

	if (user_data.USER.USER_ID == 0) {
		console.error('deezer: no user id')
		process.exit(1)
	}

	const account = 0
	const children = []

	const family = user_data["USER"]["MULTI_ACCOUNT"]["ENABLED"] && !user_data["USER"]["MULTI_ACCOUNT"]["IS_SUB_ACCOUNT"];
	if (family) {
		// could easily be implemented
		console.error('deezer: family account not supported')
		process.exit(1)
		/* const childs = this.gw.get_child_accounts();
		for (const child of childs) {
			if (child['EXTRA_FAMILY']['IS_LOGGABLE_AS']) {
				children.push({
					'id': child["USER_ID"],
					'name': child["BLOG_NAME"],
					'picture': child.get("USER_PICTURE", ""),
					'license_token': user_data["USER"]["OPTIONS"]["license_token"],
					'can_stream_hq': user_data["USER"]["OPTIONS"]["web_hq"] || user_data["USER"]["OPTIONS"]["mobile_hq"],
					'can_stream_lossless': user_data["USER"]["OPTIONS"]["web_lossless"] || user_data["USER"]["OPTIONS"]["mobile_lossless"],
					'country': user_data["USER"]["OPTIONS"]["license_country"],
					'language': user_data["USER"]["SETTING"]["global"].get("language", ""),
					'loved_tracks': child.get("LOVEDTRACKS_ID")
				});
			}
		} */
	} else {
		children.push({
			'id': user_data["USER"]["USER_ID"],
			'name': user_data["USER"]["BLOG_NAME"],
			'picture': user_data["USER"]["USER_PICTURE"] ?? "",
			'license_token': user_data["USER"]["OPTIONS"]["license_token"],
			'can_stream_hq': user_data["USER"]["OPTIONS"]["web_hq"] || user_data["USER"]["OPTIONS"]["mobile_hq"],
			'can_stream_lossless': user_data["USER"]["OPTIONS"]["web_lossless"] || user_data["USER"]["OPTIONS"]["mobile_lossless"],
			'country': user_data["USER"]["OPTIONS"]["license_country"],
			'language': user_data["USER"]["SETTING"]["global"]["language"] ?? "",
			'loved_tracks': user_data["USER"]["LOVEDTRACKS_ID"],
		})
	}

	deezer_current_user = children[account];

	if (!deezer_current_user.license_token) {
		console.error('deezer_get_track_url: no license token on current user')
		process.exit(1)
	}

	if (!deezer_current_user.can_stream_lossless || !deezer_current_user.can_stream_hq) {
		console.error('deezer_get_track_url: user cannot stream lossless or hq')
		process.exit(1)
	}

	console.log(`deezer: created api instance with ARL`)
}
