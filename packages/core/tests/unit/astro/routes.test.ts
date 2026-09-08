import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
	hasUserDefinedPublicRoute,
	injectCoreRoutes,
} from "../../../src/astro/integration/routes.js";
import * as mediaUploadRoute from "../../../src/astro/routes/api/media/[id]/upload.js";
import { GET as getMediaFile } from "../../../src/astro/routes/api/media/file/[...key].js";
import { EmDashStorageError } from "../../../src/storage/types.js";

function mockMediaContext(
	key: string | undefined,
	rangeResult?: {
		body: Uint8Array;
		contentType: string;
		size: number;
		totalSize: number;
		range: { start: number; end: number };
	},
) {
	const fullResult = {
		body: new Uint8Array([1, 2, 3]),
		contentType: "image/png",
		size: 3,
	};

	const download = vi.fn().mockImplementation(
		(_key: string, options?: { range?: { start: number; end?: number } }) => {
			return Promise.resolve(options?.range && rangeResult ? rangeResult : fullResult);
		},
	);

	return {
		context: {
			params: { key },
			locals: {
				emdash: {
					storage: { download },
				},
			},
			request: new Request("https://example.com/_emdash/api/media/file/"),
		} as Parameters<typeof getMediaFile>[0],
		download,
	};
}

function mockUnsatisfiableRangeContext(key: string | undefined, totalSize: number) {
	const download = vi.fn().mockRejectedValue(
		new EmDashStorageError("Range not satisfiable", "RANGE_NOT_SATISFIABLE", undefined, {
			totalSize,
		}),
	);

	return {
		context: {
			params: { key },
			locals: {
				emdash: {
					storage: { download },
				},
			},
			request: new Request("https://example.com/_emdash/api/media/file/"),
		} as Parameters<typeof getMediaFile>[0],
		download,
	};
}

describe("core media route injection", () => {
	async function withTempSrcDir(files: Record<string, string>, fn: (srcDir: URL) => void) {
		const root = await mkdtemp(join(tmpdir(), "emdash-routes-"));
		try {
			const srcDir = join(root, "src");
			for (const [filePath, contents] of Object.entries(files)) {
				const fullPath = join(srcDir, filePath);
				await mkdir(dirname(fullPath), { recursive: true });
				await writeFile(fullPath, contents);
			}
			fn(pathToFileURL(srcDir));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}

	function collectRoutePatterns(srcDir?: URL): string[] {
		const routes: Array<{ pattern: string; entrypoint: string }> = [];
		injectCoreRoutes((route) => routes.push(route), { srcDir });
		return routes.map((route) => route.pattern);
	}

	it("uses a catch-all media file route so storage keys can contain slashes", () => {
		const routes: Array<{ pattern: string; entrypoint: string }> = [];
		injectCoreRoutes((route) => {
			routes.push({
				...route,
				entrypoint: route.entrypoint.replaceAll("\\", "/"),
			});
		});

		expect(routes).toContainEqual(
			expect.objectContaining({
				pattern: "/_emdash/api/media/file/[...key]",
				// Route entrypoints resolve to the compiled artifact; `[`/`]` are
				// rewritten to `_` (routeArtifactName) so rolldown's reserved
				// output placeholders can't mangle dynamic-route filenames.
				entrypoint: expect.stringContaining("api/media/file/_...key_"),
			}),
		);
	});

	it("registers the pending-media upload route with PUT only", () => {
		const routes: Array<{ pattern: string; entrypoint: string }> = [];
		injectCoreRoutes((route) => routes.push(route));

		expect(routes).toContainEqual(
			expect.objectContaining({ pattern: "/_emdash/api/media/[id]/upload" }),
		);
		expect(mediaUploadRoute.PUT).toBeTypeOf("function");
		for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
			expect(mediaUploadRoute).not.toHaveProperty(method);
		}
	});

	it("registers static media folder routes before the dynamic media item route", () => {
		const patterns = collectRoutePatterns();
		const folders = patterns.indexOf("/_emdash/api/media/folders");
		const folder = patterns.indexOf("/_emdash/api/media/folders/[id]");
		const mediaItem = patterns.indexOf("/_emdash/api/media/[id]");

		expect(folders).toBeGreaterThan(-1);
		expect(folder).toBeGreaterThan(-1);
		expect(folders).toBeLessThan(mediaItem);
		expect(folder).toBeLessThan(mediaItem);
	});

	it("injects default root SEO routes when the site does not define them", () => {
		const routes = collectRoutePatterns();

		expect(routes).toContain("/robots.txt");
		expect(routes).toContain("/sitemap.xml");
		expect(routes).toContain("/sitemap-[collection].xml");
	});

	it("skips root SEO routes that are defined by the site", async () => {
		await withTempSrcDir(
			{
				"pages/robots.txt.ts": "export const GET = () => new Response('');",
				"pages/sitemap.xml.ts": "export const GET = () => new Response('');",
			},
			(srcDir) => {
				const routes = collectRoutePatterns(srcDir);

				expect(routes).not.toContain("/robots.txt");
				expect(routes).not.toContain("/sitemap.xml");
				expect(routes).toContain("/sitemap-[collection].xml");
			},
		);
	});

	it("skips the collection sitemap route when the site defines its own", async () => {
		await withTempSrcDir(
			{
				"pages/sitemap-[collection].xml.ts": "export const GET = () => new Response('');",
			},
			(srcDir) => {
				const routes = collectRoutePatterns(srcDir);

				expect(routes).not.toContain("/sitemap-[collection].xml");
				expect(routes).toContain("/sitemap.xml");
				expect(routes).toContain("/robots.txt");
			},
		);
	});

	it("detects index route files for root public route overrides", async () => {
		await withTempSrcDir(
			{
				"pages/robots.txt/index.ts": "export const GET = () => new Response('');",
			},
			(srcDir) => {
				const routes = collectRoutePatterns(srcDir);

				expect(hasUserDefinedPublicRoute(srcDir, "robots.txt")).toBe(true);
				expect(hasUserDefinedPublicRoute(srcDir, "sitemap.xml")).toBe(false);
				expect(routes).not.toContain("/robots.txt");
				expect(routes).toContain("/sitemap.xml");
			},
		);
	});

	it("detects markdown and html route files for root public route overrides", async () => {
		await withTempSrcDir(
			{
				"pages/robots.txt.md": "# Robots",
				"pages/sitemap.xml/index.html": "<html></html>",
			},
			(srcDir) => {
				const routes = collectRoutePatterns(srcDir);

				expect(hasUserDefinedPublicRoute(srcDir, "robots.txt")).toBe(true);
				expect(hasUserDefinedPublicRoute(srcDir, "sitemap.xml")).toBe(true);
				expect(routes).not.toContain("/robots.txt");
				expect(routes).not.toContain("/sitemap.xml");
			},
		);
	});
});

describe("media file catch-all route", () => {
	it("passes slash-containing keys through to storage.download", async () => {
		const { context, download } = mockMediaContext("nested/path/file.png");

		const response = await getMediaFile(context);
		expect(response.status).toBe(200);
		expect(download).toHaveBeenCalledWith("nested/path/file.png");
	});

	it("returns not found when the catch-all key is missing", async () => {
		const { context, download } = mockMediaContext(undefined);

		const response = await getMediaFile(context);
		expect(response.status).toBe(404);
		expect(download).not.toHaveBeenCalled();
	});
});

describe("media file range requests", () => {
	it("returns 206 with Content-Range for a valid single byte range", async () => {
		const { context, download } = mockMediaContext("video.mp4", {
			body: new Uint8Array([1, 2]),
			contentType: "video/mp4",
			size: 2,
			totalSize: 3,
			range: { start: 0, end: 1 },
		});

		context.request = new Request("https://example.com/_emdash/api/media/file/video.mp4", {
			headers: { Range: "bytes=0-1" },
		});

		const response = await getMediaFile(context);
		expect(response.status).toBe(206);
		expect(response.headers.get("Content-Range")).toBe("bytes 0-1/3");
		expect(response.headers.get("Content-Length")).toBe("2");
		expect(response.headers.get("Accept-Ranges")).toBe("bytes");
		expect(download).toHaveBeenCalledWith("video.mp4", { range: { start: 0, end: 1 } });
	});

	it("returns 200 full response with Accept-Ranges when no Range header is sent", async () => {
		const { context, download } = mockMediaContext("image.png");
		const response = await getMediaFile(context);
		expect(response.status).toBe(200);
		expect(response.headers.get("Accept-Ranges")).toBe("bytes");
		expect(download).toHaveBeenCalledWith("image.png");
	});

	it("ignores malformed Range headers and serves the full file", async () => {
		const { context, download } = mockMediaContext("image.png");
		context.request = new Request("https://example.com/_emdash/api/media/file/image.png", {
			headers: { Range: "items=0-1" },
		});

		const response = await getMediaFile(context);
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Range")).toBeNull();
		expect(download).toHaveBeenCalledWith("image.png");
	});

	it("returns 416 for an unsatisfiable range", async () => {
		const { context } = mockUnsatisfiableRangeContext("image.png", 10);
		context.request = new Request("https://example.com/_emdash/api/media/file/image.png", {
			headers: { Range: "bytes=100-200" },
		});

		const response = await getMediaFile(context);
		expect(response.status).toBe(416);
		expect(response.headers.get("Content-Range")).toBe("bytes */10");
	});
});
