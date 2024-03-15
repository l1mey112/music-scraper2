// drizzle.config.ts
import { Config } from "drizzle-kit";

// bun run drizzle-kit generate:sqlite
//
// on computers without node and only bun, bun will execute the above
// using bun and not node. currently this won't work, and you'll need
// to install node, then run the command manually.

export default {
	schema: "./schema.ts",
	out: "./migrations",
	dbCredentials: {
		url: "./db.sqlite",
	},
	verbose: true,
	strict: true,
} satisfies Config;
