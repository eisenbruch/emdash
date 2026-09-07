/**
 * Content change attribution (issue #2881).
 *
 * - Updates without an explicit revision author attribute the revision to the
 *   acting user instead of leaving revisions.author_id NULL.
 * - Revision attribution is separate from entry ownership, so attributing a
 *   revision never reassigns ec_*.author_id.
 * - content:afterSave hooks receive the acting user (id + role) in their event.
 */

import { Role } from "@emdash-cms/auth";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { deferred } = vi.hoisted(() => ({ deferred: [] as Array<() => void | Promise<void>> }));
vi.mock("../../../src/after.js", () => ({
	after: (fn: () => void | Promise<void>) => {
		deferred.push(fn);
	},
}));
vi.mock(
	"virtual:emdash/object-cache",
	() => ({ createObjectCache: undefined, objectCacheConfig: {} }),
	{ virtual: true },
);

import { ContentRepository } from "../../../src/database/repositories/content.js";
import { RevisionRepository } from "../../../src/database/repositories/revision.js";
import type { Database } from "../../../src/database/types.js";
import { EmDashRuntime } from "../../../src/emdash-runtime.js";
import { definePlugin } from "../../../src/plugins/define-plugin.js";
import type {
	ContentAfterSaveHandler,
	ContentBeforeSaveHandler,
} from "../../../src/plugins/types.js";
import { createTestRuntime } from "../../utils/mcp-runtime.js";
import { setupTestDatabaseWithCollections, teardownTestDatabase } from "../../utils/test-db.js";

async function flushDeferred(): Promise<void> {
	const tasks = deferred.splice(0);
	for (const task of tasks) await task();
}

const OWNER_ID = "user_owner";
const ACTOR_ID = "user_actor";
const OTHER_ID = "user_other";
const ACTOR_ROLE = Role.EDITOR;

function capturePlugin() {
	const beforeEvents: Array<Record<string, unknown>> = [];
	const afterEvents: Array<Record<string, unknown>> = [];

	const plugin = definePlugin({
		id: "attribution-capture",
		version: "1.0.0",
		capabilities: ["content:write", "content:read"],
		hooks: {
			"content:beforeSave": ((event) => {
				beforeEvents.push({ ...event });
				return event.content;
			}) as ContentBeforeSaveHandler,
			"content:afterSave": ((event) => {
				afterEvents.push({ ...event });
			}) as ContentAfterSaveHandler,
		},
	});

	return { plugin, beforeEvents, afterEvents };
}

describe("content change attribution (issue #2881)", () => {
	let db: Kysely<Database>;
	let runtime: EmDashRuntime;
	let revisions: RevisionRepository;

	beforeEach(async () => {
		deferred.length = 0;
		db = await setupTestDatabaseWithCollections();
		revisions = new RevisionRepository(db);
	});

	afterEach(async () => {
		deferred.length = 0;
		await teardownTestDatabase(db);
	});

	async function seedOwnedBy(ownerId: string): Promise<string> {
		const repo = new ContentRepository(db);
		const item = await repo.create({
			type: "post",
			data: { title: "Original title", content: [{ type: "paragraph", children: [] }] },
			slug: `attribution-${Math.random().toString(36).slice(2, 8)}`,
			status: "published",
			authorId: ownerId,
		});
		return item.id;
	}

	it("attributes the draft revision to the actor when no explicit revision author is supplied", async () => {
		const { plugin } = capturePlugin();
		runtime = createTestRuntime(db, { plugins: [plugin] });

		const entryId = await seedOwnedBy(OWNER_ID);

		const result = await runtime.handleContentUpdate("post", entryId, {
			data: { title: "Updated by actor" },
			actor: { id: ACTOR_ID, role: ACTOR_ROLE },
		});

		expect(result.success).toBe(true);

		const latest = await revisions.findLatest("post", entryId);
		expect(latest).not.toBeNull();
		expect(latest?.authorId).toBe(ACTOR_ID);

		const item = await new ContentRepository(db).findById("post", entryId);
		expect(item?.authorId).toBe(OWNER_ID);
	});

	it("keeps entry ownership unchanged when only a revision author is supplied", async () => {
		runtime = createTestRuntime(db);

		const entryId = await seedOwnedBy(OWNER_ID);

		const result = await runtime.handleContentUpdate("post", entryId, {
			data: { title: "Updated by other" },
			revisionAuthorId: OTHER_ID,
			actor: { id: ACTOR_ID, role: ACTOR_ROLE },
		});

		expect(result.success).toBe(true);

		const latest = await revisions.findLatest("post", entryId);
		expect(latest?.authorId).toBe(OTHER_ID);

		const item = await new ContentRepository(db).findById("post", entryId);
		expect(item?.authorId).toBe(OWNER_ID);
	});

	it("reassigns entry ownership only when authorId is explicitly supplied", async () => {
		runtime = createTestRuntime(db);

		const entryId = await seedOwnedBy(OWNER_ID);

		const result = await runtime.handleContentUpdate("post", entryId, {
			data: { title: "Reassigned owner" },
			revisionAuthorId: ACTOR_ID,
			authorId: OTHER_ID,
			actor: { id: ACTOR_ID, role: ACTOR_ROLE },
		});

		expect(result.success).toBe(true);

		const latest = await revisions.findLatest("post", entryId);
		expect(latest?.authorId).toBe(ACTOR_ID);

		const item = await new ContentRepository(db).findById("post", entryId);
		expect(item?.authorId).toBe(OTHER_ID);
	});

	it("passes the acting user to content:beforeSave and content:afterSave hooks", async () => {
		const { plugin, beforeEvents, afterEvents } = capturePlugin();
		runtime = createTestRuntime(db, { plugins: [plugin] });

		const entryId = await seedOwnedBy(OWNER_ID);

		const result = await runtime.handleContentUpdate("post", entryId, {
			data: { title: "Hook actor test" },
			actor: { id: ACTOR_ID, role: ACTOR_ROLE },
		});

		expect(result.success).toBe(true);
		expect(beforeEvents).toHaveLength(1);
		expect(beforeEvents[0]?.actor).toEqual({ id: ACTOR_ID, role: ACTOR_ROLE });

		await flushDeferred();
		expect(afterEvents).toHaveLength(1);
		expect(afterEvents[0]?.actor).toEqual({ id: ACTOR_ID, role: ACTOR_ROLE });
	});
});
