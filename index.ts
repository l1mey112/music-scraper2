import { db } from "./db";
import { sigint_region, sigint_region_end } from "./sigint";
import { Spotify } from "./spotify";

const spotify = await Spotify.make()

await spotify.index_liked_songs()
