/**
 * Serve uploaded media files
 *
 * GET /_emdash/api/media/file/:key - Serve file from storage
 */

import type { APIRoute } from "astro";

import { apiError, handleError } from "#api/error.js";
import { EmDashStorageError } from "../../../../../storage/types.js";
import type { ByteRange } from "../../../../../storage/types.js";

export const prerender = false;

/**
 * Content types that are safe to display inline (simple raster/vector images, video, audio).
 * Everything else gets Content-Disposition: attachment to prevent script execution.
 */
const SAFE_INLINE_TYPES = new Set([
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp",
	"image/avif",
	"image/x-icon",
	"video/mp4",
	"video/webm",
	"video/quicktime",
	"audio/mpeg",
	"audio/wav",
	"audio/ogg",
]);

export const GET: APIRoute = async ({ params, locals, request }) => {
	const { key } = params;
	const { emdash } = locals;

	if (!key) {
		return apiError("NOT_FOUND", "File not found", 404);
	}

	// Backup archives share the storage bucket but hold the site's full
	// content export — they must never be reachable through the public,
	// unauthenticated media route. Admins download them via the
	// authenticated backups API.
	if (key.startsWith("backups/")) {
		return apiError("NOT_FOUND", "File not found", 404);
	}

	if (!emdash?.storage) {
		return apiError("NOT_CONFIGURED", "Storage not configured", 500);
	}

	const range = parseRangeHeader(request.headers.get("Range"));

	try {
		const result = range
			? await emdash.storage.download(key, { range })
			: await emdash.storage.download(key);

		const headers: Record<string, string> = {
			"Content-Type": result.contentType,
			"Cache-Control": "public, max-age=31536000, immutable",
			"X-Content-Type-Options": "nosniff",
			"Accept-Ranges": "bytes",
			// Sandbox CSP on all user-uploaded content - prevents script execution
			// even for SVGs navigated to directly or content types that support scripting.
			"Content-Security-Policy":
				"sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
		};

		if (result.size !== undefined) {
			headers["Content-Length"] = String(result.size);
		}

		// Safe image/media types can render inline; everything else (SVG, PDF,
		// HTML, JS, etc.) must be downloaded to prevent stored XSS.
		if (SAFE_INLINE_TYPES.has(result.contentType)) {
			headers["Content-Disposition"] = "inline";
		} else {
			headers["Content-Disposition"] = "attachment";
		}

		const isPartial = range && result.range && result.totalSize !== undefined;
		if (isPartial) {
			headers["Content-Range"] =
				`bytes ${result.range!.start}-${result.range!.end}/${result.totalSize}`;
			return new Response(result.body, { status: 206, headers });
		}

		return new Response(result.body, { status: 200, headers });
	} catch (error) {
		if (error instanceof EmDashStorageError && error.code === "RANGE_NOT_SATISFIABLE") {
			const totalSize = error.details?.totalSize;
			return new Response(null, {
				status: 416,
				headers: {
					"Content-Range": `bytes */${totalSize ?? "*"}`,
				},
			});
		}

		// Check if it's a "not found" error
		if (
			error instanceof Error &&
			(error.message.includes("not found") || error.message.includes("NOT_FOUND"))
		) {
			return apiError("NOT_FOUND", "File not found", 404);
		}
		return handleError(error, "Failed to serve file", "FILE_SERVE_ERROR");
	}
};

/**
 * Parse a single `bytes=start-end` Range header value.
 * Returns null for missing, multi-range, or malformed headers.
 */
function parseRangeHeader(rangeHeader: string | null): ByteRange | null {
	if (!rangeHeader) return null;

	const match = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
	if (!match) return null;

	const start = parseInt(match[1] as string, 10);
	const end = (match[2] as string) ? parseInt(match[2] as string, 10) : undefined;

	if (Number.isNaN(start) || start < 0 || (end !== undefined && (Number.isNaN(end) || end < 0))) {
		return null;
	}

	return { start, end };
}
