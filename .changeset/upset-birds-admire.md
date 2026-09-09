---
"@emdash-cms/plugin-ai-moderation": patch
---

Fixes AI moderation hooks being silently skipped at runtime because the plugin did not declare the `users:read` capability required by `comment:beforeCreate` and `comment:moderate`.
