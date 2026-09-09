---
"emdash": patch
---

Fixes `POST /_emdash/api/admin/bylines/:id/translations` so translated bylines inherit the source's `user_id`. Author-inferred credits now keep resolving at the new locale instead of silently dropping after a translation is created. When the user already owns a different byline at the target locale, the endpoint returns `409 CONFLICT`.
