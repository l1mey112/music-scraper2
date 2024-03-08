let sigint_f: undefined | (() => Promise<void>)

let inside = false

export function sigint_region(f: () => Promise<void>) {
	if (sigint_f || inside) {
		console.error('sigint_region: fatal double region')
		process.exit(1)
	}

	sigint_f = f
}

export function sigint_region_end() {
	if (!sigint_f) {
		console.error('sigint_region_end: fatal double region end')
		process.exit(1)
	}

	sigint_f = undefined
}

// TODO: handle throwing as well

process.on('SIGINT', () => {
	// i doubt this will happen
	if (inside) {
		console.error('sigint: warning still waiting')
		return
	}

	if (sigint_f) {
		console.log('sigint: calling region')
		
		inside = true
		sigint_f().finally(() => {
			process.exit(0)
		})
	} else {
		process.exit(0)
	}
})
