---
"emdash": patch
---

Fixes MCP write tools leaving cached pages stale. `content_create`, `content_update`, `content_publish`, `content_unpublish`, `content_delete`, `content_restore`, `content_permanent_delete`, `content_schedule`, `content_unschedule`, `content_discard_draft` and `content_duplicate` now invalidate the same route-cache tags as the matching REST routes, as do the taxonomy, menu and `settings_update` tools. Previously, on a site with Astro route caching enabled (for example `cacheCloudflare()`), a change made over MCP reached the database but the cached page kept serving the old copy until its TTL expired.
