import { BunFile } from "bun";
import { nanoid } from "./nanoid";
import { resolve } from "path";
import { existsSync } from "fs";

const media = resolve("media")

if (!existsSync(media)) {
	console.error(`media directory does not exist at ${media}`)
	process.exit(1)
}

export function create_sharded_lazy_bunfile(dot_ext: string): [BunFile, string] {
	const [path, hash] = create_sharded_lazy_path(dot_ext)
	return [Bun.file(path), hash]
}

export function create_sharded_lazy_path(dot_ext: string): [string, string] {
	const hash = nanoid() + dot_ext
	const shard = hash.slice(0, 2)

	// bun automatically creates folders
	return [`${media}/${shard}/${hash}`, hash]
}
