---
"emdash": patch
---

Emits a clear build-time warning when the host Astro config is not set to `output: "server"`, instead of failing during static prerendering with a cryptic `getStaticPaths()` error inside an injected route.
