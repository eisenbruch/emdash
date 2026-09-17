/**
 * The webhook is the only step in a submission whose outcome nobody waits for. It has to survive the
 * response being sent, and a response that is not a success has to reach the log: `fetch` resolves on
 * a 4xx, a 5xx, and on the login page an auth wall redirects to, so none of those reject.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { submitHandler } from "../src/handlers/submit.js";
import type { FormDefinition } from "../src/types.js";

const WEBHOOK = "https://example.test/hook";

/** The webhook runs after the response, so let its microtasks drain before asserting. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function form(): FormDefinition {
	return {
		name: "Contact",
		slug: "contact",
		status: "active",
		pages: [{ fields: [{ name: "email", label: "Email", type: "email", required: true }] }],
		submissionCount: 0,
		lastSubmissionAt: null,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		settings: {
			spamProtection: "none",
			notifyEmails: [],
			digestEnabled: false,
			digestHour: 9,
			retentionDays: 0,
			submitLabel: "Send",
			confirmationMessage: "Thanks",
			webhookUrl: WEBHOOK,
		},
	} as unknown as FormDefinition;
}

function context(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
	const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
	const stored: Array<Record<string, unknown>> = [];
	const ctx = {
		input: { formId: "contact", data: { email: "someone@example.test" } },
		storage: {
			forms: {
				get: async (id: string) => (id === "contact" ? form() : null),
				put: async () => {},
				query: async () => ({ items: [{ id: "contact", data: form() }] }),
			},
			submissions: {
				put: async (_id: string, data: Record<string, unknown>) => void stored.push(data),
				get: async () => null,
				count: async () => 1,
				query: async () => ({ items: [] }),
			},
		},
		kv: { get: async () => null, set: async () => {} },
		log,
		http: { fetch: vi.fn(fetchImpl) },
		media: undefined,
		email: undefined,
		requestMeta: { ip: "203.0.113.1", userAgent: "test", referer: null, headers: {} },
	};
	return { ctx, log, stored };
}

function response(init: { status?: number; redirected?: boolean; url?: string }): Response {
	const res = new Response("", { status: init.status ?? 200 });
	// `redirected` and `url` are read-only on a constructed Response; a real redirected fetch sets both.
	Object.defineProperty(res, "redirected", { value: init.redirected ?? false });
	Object.defineProperty(res, "url", { value: init.url ?? WEBHOOK });
	return res;
}

describe("submission webhook", () => {
	beforeEach(() => vi.clearAllMocks());

	it("logs a 5xx, which fetch resolves rather than rejects", async () => {
		const { ctx, log } = context(async () => response({ status: 500 }));
		// eslint-disable-next-line typescript/no-unsafe-argument -- minimal RouteContext for this step
		const result = await submitHandler(ctx as never);
		await settle();

		expect(result.success).toBe(true); // the visitor is never shown the webhook's problem
		expect(log.error).toHaveBeenCalledWith("Webhook failed", { url: WEBHOOK, status: 500 });
	});

	it("logs a redirect to somewhere else, which an auth wall answers with a 200", async () => {
		const { ctx, log } = context(async () =>
			response({ status: 200, redirected: true, url: "https://example.test/login" }),
		);
		await submitHandler(ctx as never);
		await settle();

		expect(log.warn).toHaveBeenCalledWith("Webhook was redirected", {
			url: WEBHOOK,
			finalUrl: "https://example.test/login",
		});
	});

	it("logs a transport error", async () => {
		const { ctx, log } = context(async () => {
			throw new Error("boom");
		});
		await submitHandler(ctx as never);
		await settle();

		expect(log.error).toHaveBeenCalledWith("Webhook failed", {
			url: WEBHOOK,
			error: "Error: boom",
		});
	});

	it("says nothing when the webhook succeeds, and still calls it", async () => {
		const { ctx, log } = context(async () => response({ status: 200 }));
		await submitHandler(ctx as never);
		await settle();

		expect(ctx.http.fetch).toHaveBeenCalledWith(
			WEBHOOK,
			expect.objectContaining({ method: "POST" }),
		);
		expect(log.error).not.toHaveBeenCalled();
		expect(log.warn).not.toHaveBeenCalled();
	});
});
