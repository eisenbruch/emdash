/**
 * Regression: byline translations inherit the source's user_id so
 * author-inferred credits keep resolving at the new locale.
 */

import { Role } from "@emdash-cms/auth";
import type { APIContext } from "astro";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as createBylineTranslation } from "../../../src/astro/routes/api/admin/bylines/[id]/translations.js";
import { BylineRepository } from "../../../src/database/repositories/byline.js";
import { UserRepository } from "../../../src/database/repositories/user.js";
import type { Database } from "../../../src/database/types.js";
import { SchemaRegistry } from "../../../src/schema/registry.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface BuildOpts {
	db: Kysely<Database>;
	request: Request;
	params?: { id: string };
	user: { id: string; role: (typeof Role)[keyof typeof Role] } | null;
}

function buildContext(opts: BuildOpts): APIContext {
	return {
		params: opts.params ?? {},
		url: new URL(opts.request.url),
		request: opts.request,
		locals: {
			emdash: { db: opts.db, config: {} },
			user: opts.user,
		},
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- minimal stub for tests
	} as unknown as APIContext;
}

function postTranslationReq(bylineId: string, body: unknown): Request {
	return new Request(`http://localhost/_emdash/api/admin/bylines/${bylineId}/translations`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-EmDash-Request": "1",
		},
		body: JSON.stringify(body),
	});
}

const adminUser = { id: "admin-1", role: Role.ADMIN };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /admin/bylines/:id/translations inherits userId", () => {
	let db: Kysely<Database>;

	beforeEach(async () => {
		db = await setupTestDatabase();
		const registry = new SchemaRegistry(db);
		await registry.createCollection({ slug: "posts", label: "Posts", labelSingular: "Post" });
		await registry.createField("posts", { slug: "title", label: "Title", type: "string" });
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
	});

	it("inherits user_id from a user-linked source byline", async () => {
		const users = new UserRepository(db);
		const bylines = new BylineRepository(db);
		const turingUser = await users.create({ email: "turing@example.com", name: "Alan Turing" });

		const source = await bylines.create({
			slug: "alan-turing",
			displayName: "Alan Turing",
			userId: turingUser.id,
		});

		const res = await createBylineTranslation(
			buildContext({
				db,
				request: postTranslationReq(source.id, { locale: "fr", displayName: "Alan Turing" }),
				params: { id: source.id },
				user: adminUser,
			}),
		);

		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data.userId).toBe(turingUser.id);
		expect(body.data.locale).toBe("fr");
		expect(body.data.translationGroup).toBe(source.translationGroup ?? source.id);
	});

	it("keeps author-inferred credits resolving after translation", async () => {
		const users = new UserRepository(db);
		const bylines = new BylineRepository(db);
		const turingUser = await users.create({ email: "turing@example.com", name: "Alan Turing" });

		const source = await bylines.create({
			slug: "alan-turing",
			displayName: "Alan Turing",
			userId: turingUser.id,
		});

		// Translate the byline to fr.
		await createBylineTranslation(
			buildContext({
				db,
				request: postTranslationReq(source.id, { locale: "fr", displayName: "Alan Turing" }),
				params: { id: source.id },
				user: adminUser,
			}),
		);

		// The author-linked lookup is strict per locale. With the
		// translated byline now carrying the same user_id, inference
		// at fr must resolve — previously it returned null.
		const frByline = await bylines.findByUserId(turingUser.id, { locale: "fr" });
		expect(frByline).not.toBeNull();
		expect(frByline!.userId).toBe(turingUser.id);
		expect(frByline!.locale).toBe("fr");
	});

	it("returns CONFLICT when the user already owns a different byline at the target locale", async () => {
		const users = new UserRepository(db);
		const bylines = new BylineRepository(db);
		const turingUser = await users.create({ email: "turing@example.com", name: "Alan Turing" });

		// First byline for this user at en.
		const source = await bylines.create({
			slug: "alan-turing",
			displayName: "Alan Turing",
			userId: turingUser.id,
		});

		// A different byline, already linked to the same user at fr.
		await bylines.create({
			slug: "alain-turing",
			displayName: "Alain Turing",
			locale: "fr",
			userId: turingUser.id,
		});

		// Translating the English byline into French would collide on
		// (user_id, locale), so the handler must reject with CONFLICT.
		const res = await createBylineTranslation(
			buildContext({
				db,
				request: postTranslationReq(source.id, { locale: "fr", displayName: "Alan Turing" }),
				params: { id: source.id },
				user: adminUser,
			}),
		);

		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.error.code).toBe("CONFLICT");
	});

	it("still allows translating a guest byline that has no user_id", async () => {
		const bylines = new BylineRepository(db);
		const source = await bylines.create({
			slug: "guest-author",
			displayName: "Guest Author",
			isGuest: true,
		});

		const res = await createBylineTranslation(
			buildContext({
				db,
				request: postTranslationReq(source.id, {
					locale: "fr",
					displayName: "Auteur Invité",
				}),
				params: { id: source.id },
				user: adminUser,
			}),
		);

		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data.userId).toBeNull();
	});
});
