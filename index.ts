import { db } from "./db";
import * as schema from "./schema";
import { Spotify } from "./spotify";

const spotify = await Spotify.make()
await spotify.index_liked_songs()

const k = await db.schema.select()
	.from(schema.track)
	.limit(10)

console.log(k)
