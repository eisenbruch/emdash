---
"emdash": patch
---

Fixes content change attribution so revisions record who saved them without reassigning entry ownership.

- REST content saves and MCP `content_update` now attribute the new revision to the acting user when no explicit revision author is supplied.
- `revisions.author_id` is set independently of `ec_{collection}.author_id`; the latter only changes when an update explicitly includes `authorId`.
- `content:beforeSave` and `content:afterSave` hooks now receive the acting user as `event.actor` (`{ id, role }`).
