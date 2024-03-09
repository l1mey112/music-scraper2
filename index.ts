import { db } from "./db";
import * as schema from "./schema";
import { sigint_region, sigint_region_end } from "./sigint";
import { Spotify } from "./spotify";

const spotify = await Spotify.make()
await spotify.index_liked_songs()

const k = await db.schema.select()
	.from(schema.track)
	.limit(10)

console.log(k)

db.sqlite.close() // kill WALs and close the db
