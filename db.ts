import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import * as schema from './schema';

class DB {
	sqlite: Database
	schema: BunSQLiteDatabase<typeof schema>

	constructor() {
		this.sqlite = new Database('db.sqlite')
		this.schema = drizzle(this.sqlite, { schema })
	}
}

export const db = new DB();
