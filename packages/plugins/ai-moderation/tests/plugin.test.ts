import { describe, it, expect } from "vitest";

import { createPlugin } from "../src/index.js";

describe("createPlugin", () => {
	it("declares the users:read capability required by its comment hooks", () => {
		const plugin = createPlugin();

		expect(plugin.capabilities).toContain("users:read");
	});

	it("registers comment:beforeCreate and comment:moderate hooks", () => {
		const plugin = createPlugin();

		expect(plugin.hooks["comment:beforeCreate"]).toBeDefined();
		expect(plugin.hooks["comment:moderate"]).toBeDefined();
		expect(plugin.hooks["comment:moderate"]?.exclusive).toBe(true);
	});
});
