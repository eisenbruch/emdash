/**
 * Regression test for #2947: the EmDash integration must surface a build-time
 * warning when the host Astro config is not `output: "server"`, because the
 * injected API routes are dynamic and fail during static prerendering with a
 * confusing error in a compiled file.
 */

import { describe, expect, it } from "vitest";

import { missingServerOutputWarning } from "../../../../src/astro/integration/index.js";

describe("missingServerOutputWarning (#2947)", () => {
	it("returns undefined when output is \"server\"", () => {
		expect(missingServerOutputWarning("server")).toBeUndefined();
	});

	it("warns with an actionable fix when output is \"static\"", () => {
		const warning = missingServerOutputWarning("static");
		expect(warning).toContain('output: "server"');
		expect(warning).toContain("static");
	});

	it("warns when output is \"hybrid\"", () => {
		const warning = missingServerOutputWarning("hybrid");
		expect(warning).toContain('output: "server"');
		expect(warning).toContain("hybrid");
	});
});
