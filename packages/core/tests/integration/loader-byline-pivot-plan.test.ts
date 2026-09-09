/**
 * Query-plan shape of the pivot-driven byline listing (#2616).
 *
 * A byline-only filter used to fall into the generic single-table branch and
 * probe a correlated `EXISTS` per row. On stats-blind SQLite/D1 a selective
 * byline walked the whole collection instead of short-circuiting on `LIMIT`.
 * The pivot-drive branch seeks `_emdash_content_bylines` by byline and joins
 * the content row directly.
 */

import Database from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { afterEach, beforeEach, expect, it } from "vitest";

import { runMigrations } from "../../src/database/migrations/runner.js";
import { BylineRepository } from "../../src/database/repositories/byline.js";
import { ContentRepository } from "../../src/database/repositories/content.js";
import type { Database as DatabaseSchema } from "../../src/database/types.js";
import { emdashLoader } from "../../src/loader.js";
import { runWithContext } from "../../src/request-context.js";
import { SchemaRegistry } from "../../src/schema/registry.js";

interface CapturedQuery {
	sql: string;
	parameters: readonly unknown[];
}

let sqlite: Database.Database;
let db: Kysely<DatabaseSchema>;
let captured: CapturedQuery[];

beforeEach(async () => {
	captured = [];
	sqlite = new Database(":memory:");
	db = new Kysely<DatabaseSchema>({
		dialect: new SqliteDialect({ database: sqlite }),
		log(event) {
			if (event.level === "query") {
				captured.push({ sql: event.query.sql, parameters: event.query.parameters });
			}
		},
	});

	await runMigrations(db);

	const registry = new SchemaRegistry(db);
	await registry.createCollection({ slug: "post", label: "Posts", labelSingular: "Post" });
	await registry.createField("post", { slug: "title", label: "Title", type: "string" });

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema vs Database type
	const anyDb = db as any;
	const content = new ContentRepository(anyDb);
	const bylines = new BylineRepository(anyDb);
	const byline = await bylines.create({ slug: "author", displayName: "Author", locale: "en" });
	const group = byline.translationGroup ?? byline.id;

	for (let i = 0; i < 30; i++) {
		const post = await content.create({
			type: "post",
			slug: `post-${i}`,
			data: { title: `Post ${i}` },
			status: "published",
			locale: "en",
		});
		if (i === 0) {
			await bylines.setContentBylines("post", post.id, [{ bylineId: byline.id }]);
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- group is always populated by the test setup
	(globalThis as any).__test_byline_group__ = group;
});

afterEach(async () => {
	await db.destroy();
});

function bindable(p: unknown): unknown {
	if (typeof p === "boolean") return p ? 1 : 0;
	if (p instanceof Date) return p.toISOString();
	if (p === undefined) return null;
	return p;
}

function explain(query: CapturedQuery): string {
	const rows = sqlite
		.prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
		.all(...query.parameters.map(bindable)) as { detail: string }[];
	return rows.map((r) => r.detail).join("\n");
}

function pivotQueryPlan(): string {
	const query = captured.find((q) => q.sql.includes("picked"));
	expect(query, "expected the loader to emit a pivot-drive query").toBeDefined();
	return explain(query!);
}

async function runLoad(extra: Record<string, unknown>): Promise<void> {
	captured = [];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test harness only
	const group = (globalThis as any).__test_byline_group__;
	const loader = emdashLoader();
	await runWithContext({ editMode: false, db }, () =>
		loader.loadCollection!({
			filter: { type: "post", where: { byline: group } as never, limit: 5, ...extra },
		}),
	);
}

it("seeks the byline pivot for a published_at sort", async () => {
	await runLoad({ orderBy: { published_at: "desc" } });
	const plan = pivotQueryPlan();
	expect(plan).toContain("idx_content_bylines_byline");
	expect(plan).not.toContain("SCAN r");
});

it("seeks the byline pivot for the default created_at sort", async () => {
	await runLoad({});
	const plan = pivotQueryPlan();
	expect(plan).toContain("idx_content_bylines_byline");
	expect(plan).not.toContain("SCAN r");
});

it("seeks the byline pivot bounded by locale for an explicit locale filter", async () => {
	await runLoad({ orderBy: { published_at: "desc" }, locale: "en" });
	const plan = pivotQueryPlan();
	expect(plan).toContain("idx_content_bylines_byline");
	expect(plan).not.toContain("SCAN r");
});

it("updated_at sort still seeks the byline pivot and avoids scanning the content table", async () => {
	await runLoad({ orderBy: { updated_at: "desc" } });
	const plan = pivotQueryPlan();
	expect(plan).toContain("idx_content_bylines_byline");
	expect(plan).not.toContain("SCAN cb");
	expect(plan).not.toContain("SCAN r");
});
