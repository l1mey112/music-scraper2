// deezer-api and deezer-api-ts are so fucking old
// reverse engineering deezer-py instead

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
			"Cookie": `arl=${deezer_arl}; Domain=.deezer.com; Path=/; HttpOnly`
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

// use dot notation, example `deezer.getUserData`
// class GW
// result_json['results']['checkForm'] is the api token
export async function deezer_gw_json(method: string, params: { [key: string]: string } = {}): Promise<any> {
	/* if (!this.api_token && method !== 'deezer.getUserData') {
		this.api_token = await this._get_token();
	} */

	const p = {
		api_version: "1.0",
		api_token: method === 'deezer.getUserData' ? 'null' : this.api_token,
		input: '3',
		method: method,
		...params
	}

	const url = new URL("http://www.deezer.com/ajax/gw-light.php");
	url.search = new URLSearchParams(p).toString();

	try {
		const response = await fetch(url.toString(), {
			method: 'POST',
			// body: JSON.stringify(args),
			headers: {
				"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:83.0) Gecko/20100101 Firefox/83.0",
				"Cookie": `arl=${deezer_arl}; Domain=.deezer.com; Path=/; HttpOnly`
			},
		});
		const result_json: any = await response.json();
		if (result_json.error.length > 0) {
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

export async function deezer_create() {
	// TODO: if we ever need to use the gw api, its there
	//       gw does allow us to get lyrics
	//       https://stackoverflow.com/questions/42165724/how-to-get-lyrics-from-the-deezer-api

	/* const user_data = await deezer_gw_json('deezer.getUserData')

	// if no keys
	if (Object.keys(user_data).length === 0) {
		console.error('deezer: no user data')
		process.exit(1)
	}

	if  (user_data.USER.USER_ID === 0) {
		console.error('deezer: no user id')
		process.exit(1)
	} */

	console.log(`deezer: created api instance with ARL`)
}
