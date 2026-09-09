/**
 * Extract the admin locale catalogs when running in CI, so that published
 * packages (including pkg.pr.new previews) include the latest strings even
 * when the feature branch has not been re-extracted yet.
 */
import { spawnSync } from "node:child_process";

if (!process.env.CI) {
	process.exit(0);
}

const result = spawnSync("pnpm", ["run", "locale:extract"], {
	stdio: "inherit",
	shell: false,
});

process.exit(result.status ?? 1);
