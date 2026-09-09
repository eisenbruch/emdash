/**
 * Regression guard for issue #2975.
 *
 * The Portfolio template renders `pages` entries as root-level Astro routes
 * (e.g. `src/pages/about.astro` serves `/about`), but the shipped seed did not
 * set a custom `urlPattern` for the `pages` collection. Without one, the admin
 * preview falls back to `/{collection}/{slug}` (`/pages/about`), which 404s.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "../../src/database/types.js";
import { applySeed } from "../../src/seed/apply.js";
import type { SeedFile } from "../../src/seed/types.js";
import { setupTestDatabase, teardownTestDatabase } from "../utils/test-db.js";

const WORKSPACE_ROOT = resolve(import.meta.dirname, "../../../..");

const AFFECTED_SEEDS = [
	"templates/portfolio/seed/seed.json",
	"templates/portfolio-cloudflare/seed/seed.json",
] as const;

const EXPECTED_PATTERN = "/{slug}";

function loadSeed(rel: string): SeedFile {
	const abs = resolve(WORKSPACE_ROOT, rel);
	return JSON.parse(readFileSync(abs, "utf8")) as SeedFile;
}

function buildExpectedUrl(slug: string): string {
	return EXPECTED_PATTERN.replace("{slug}", slug);
}

describe("affected template seeds route pages at the root (issue #2975)", () => {
	let db: Kysely<Database>;

	beforeEach(async () => {
		db = await setupTestDatabase();
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
	});

	for (const rel of AFFECTED_SEEDS) {
		it(`${rel}: pages collection stores the root URL pattern`, async () => {
			const seed = loadSeed(rel);

			await applySeed(db, seed, {
				includeContent: true,
				skipMediaDownload: true,
			});

			const row = await db
				.selectFrom("_emdash_collections")
				.select("url_pattern")
				.where("slug", "=", "pages")
				.executeTakeFirst();

			expect(row?.url_pattern).toBe(EXPECTED_PATTERN);
		});

		it(`${rel}: seeded page entries resolve to root-level URLs`, async () => {
			const seed = loadSeed(rel);
			const pageEntries = seed.content?.pages ?? [];

			await applySeed(db, seed, {
				includeContent: true,
				skipMediaDownload: true,
			});

			for (const entry of pageEntries) {
				if (!entry.slug) continue;

				const expected = buildExpectedUrl(entry.slug);

				expect(expected, `seed entry ${entry.slug} should resolve to a root-level URL`).not.toMatch(
					/^\/pages\//,
				);

				for (const contentRow of await db
					.selectFrom("ec_pages")
					.select("slug")
					.where("slug", "=", entry.slug)
					.execute()) {
					expect(buildExpectedUrl(contentRow.slug)).toBe(`/${contentRow.slug}`);
				}
			}
		});
	}
});
