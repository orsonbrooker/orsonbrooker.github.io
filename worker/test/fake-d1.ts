// A stand-in for D1 in tests: a real SQLite database in memory (Node's built-in node:sqlite), built
// from the migrations, with just enough of D1's API for the Worker's code:
// prepare().bind().all()/first()/run(), and batch() (all at once, in one transaction).
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Env } from "../src/util.ts";

export function fakeEnv(): { env: Env; db: DatabaseSync } {
	const db = new DatabaseSync(":memory:");
	const dir = new URL("../migrations/", import.meta.url);
	for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(file, dir), "utf8"));
	const prepare = (sql: string) => {
		let args: unknown[] = [];
		const stmt = {
			bind: (...values: unknown[]) => ((args = values), stmt),
			all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
			first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
			run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(args as never[])).changes) } }),
			allNow: () => ({ results: db.prepare(sql).all(...(args as never[])) }),
		};
		return stmt;
	};
	const batch = async (stmts: ReturnType<typeof prepare>[]) => {
		db.exec("BEGIN");
		try {
			const out = stmts.map((s) => s.allNow());
			db.exec("COMMIT");
			return out;
		} catch (err) {
			db.exec("ROLLBACK");
			throw err;
		}
	};
	return { env: { DB: { prepare, batch }, HASH_SECRET: "test-secret" } as unknown as Env, db };
}
