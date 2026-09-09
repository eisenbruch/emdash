import type { Kysely } from "kysely";
import { sql } from "kysely";

import { columnExists, listTablesLike } from "../dialect-helpers.js";
import { validateIdentifier } from "../validate.js";

/**
 * Denormalize the filter + sort columns from `ec_*` onto
 * `_emdash_content_bylines` and index the pivot by `byline_id` (#2616).
 *
 * A byline-only filter used the generic single-table path, applying the
 * predicate as a correlated `EXISTS` per row. On stats-blind SQLite/D1 a
 * selective byline never filled the `LIMIT`, so the scan walked the entire
 * collection. Copying `status`, `deleted_at`, `locale`, `published_at`, and
 * `created_at` from the locale-specific `ec_*` row onto the junction lets the
 * loader seek `_emdash_content_bylines` by `(byline_id, collection_slug, …)`
 * and short-circuit on `LIMIT`, touching `ec_*` only by primary key to hydrate
 * the page.
 *
 * `_emdash_content_bylines` already has a `created_at` column (credit creation
 * time), so the denormalized content columns use a `content_` prefix.
 *
 * The denormalized values are advisory; the read path re-checks predicates on
 * the joined `ec_*` row. `updated_at` is not copied because it moves on every
 * edit and is seldom a public sort, so its write cost outweighs its read value.
 *
 * Forward-only.
 */

const DENORM_COLUMNS = [
	"content_status",
	"content_deleted_at",
	"content_locale",
	"content_published_at",
	"content_created_at",
] as const;

const INDEXES: { name: string; columns: string }[] = [
	{
		name: "idx_content_bylines_byline_collection",
		columns: "byline_id, collection_slug, content_id",
	},
	{
		name: "idx_content_bylines_byline_pub",
		columns: "byline_id, collection_slug, content_published_at DESC, content_id DESC",
	},
	{
		name: "idx_content_bylines_byline_crt",
		columns: "byline_id, collection_slug, content_created_at DESC, content_id DESC",
	},
	{
		name: "idx_content_bylines_byline_locale_pub",
		columns:
			"byline_id, collection_slug, content_locale, content_published_at DESC, content_id DESC",
	},
	{
		name: "idx_content_bylines_byline_locale_crt",
		columns: "byline_id, collection_slug, content_locale, content_created_at DESC, content_id DESC",
	},
];

export async function up(db: Kysely<unknown>): Promise<void> {
	for (const column of DENORM_COLUMNS) {
		if (await columnExists(db, "_emdash_content_bylines", column)) continue;
		await sql`
			ALTER TABLE _emdash_content_bylines ADD COLUMN ${sql.ref(column)} TEXT
		`.execute(db);
	}

	const tableNames = await listTablesLike(db, "ec_%");
	for (const tableName of tableNames) {
		validateIdentifier(tableName, "content table name");
		const slug = tableName.slice("ec_".length);
		await sql`
			UPDATE _emdash_content_bylines
			SET (content_status, content_deleted_at, content_locale, content_published_at, content_created_at) = (
				SELECT status, deleted_at, locale, published_at, created_at
				FROM ${sql.ref(tableName)}
				WHERE ${sql.ref(tableName)}.id = _emdash_content_bylines.content_id
			)
			WHERE collection_slug = ${slug}
		`.execute(db);
	}

	for (const index of INDEXES) {
		await sql`
			CREATE INDEX IF NOT EXISTS ${sql.ref(index.name)}
			ON _emdash_content_bylines (${sql.raw(index.columns)})
		`.execute(db);
	}
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	// Forward-only.
}
