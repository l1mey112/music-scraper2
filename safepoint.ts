// whilst a safepoint is active, the program can't die
// only after releasing the safepoint can the program die

// const k = safepoint("spotify.scrape")
// k.progress(0.1)
// k.progress(0.2)
// k.progress(1.0)
// k.release()

const safepoints: { name: string, progress: number}[] = []

function safepoint_print() {
	let i = 1
	for (const sp of safepoints) {
		console.error(`${i}: ${sp.name}: ${sp.progress * 100}%`)
		i++
	}
}

// safepoint reference type
class Safepoint {
	id: number
	
	constructor(id: number) {
		this.id = id
	}

	progress(progress: number) {
		if (this.id == -1) {
			console.error("safepoint: fatal progress on dead reference")
			process.exit(1)
		}

		safepoints[this.id].progress = progress
	}
	
	release() {
		if (this.id == -1) {
			console.error("safepoint: fatal release on dead reference")
			process.exit(1)
		}

		if (this.id + 1 != safepoints.length) {
			console.error(`safepoint: fatal release ${safepoints[this.id].name} (id: ${this.id + 1}) out of order`)
			safepoint_print()
			process.exit(1)
		}

		// kill the reference
		this.id = -1

		safepoints.length--
		handler_terminate()
	}
}

export function safepoint(name: string): Safepoint {
	const id = safepoints.length
	safepoints.push({ name, progress: 0 })

	return new Safepoint(id)
}

let safepoint_terminate = false

function handler() {
	console.error("safepoint: exit")

	safepoint_terminate = true

	if (safepoints.length > 0) {
		console.error("safepoint: warning safepoint/s active, will exit soon")
		safepoint_print()
	}
}

function handler_terminate() {
	if (safepoint_terminate && safepoints.length == 0) {
		console.error("safepoint: terminate")
		process.exit(0)
	}
}

// signal(7)
process.on("SIGINT", handler)
process.on("SIGTERM", handler)
