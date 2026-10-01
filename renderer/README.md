# OtomotifZone design renderer

Standalone internal HTTP service for the n8n workflow. It renders the existing brand layout to a JPEG at **1080 × 1440 px**. It is not reachable on a host port; n8n reaches it at `http://renderer:3000` on Docker network `n8n_default`.

`POST /render-instagram` accepts the same multipart fields, renders a separate **1080 × 1350 px (4:5)** JPEG without cropping the lower text panel, stores it under an unguessable UUID, and returns its public HTTPS URL. The master `/render` output remains 1080 × 1440. Public exports are retained for 30 days so Meta can fetch them during publication.

## API used by n8n

`POST /render` accepts `multipart/form-data` fields `post_id`, `category`, `author`, `headline`, `subheadline`, optional `focus_x`/`focus_y`, and the source image file in field `photo`. The HTTP Request node takes `photo` from its incoming binary property `data`. Success returns `image/jpeg` as a binary file. Invalid text/photo returns JSON 4xx and must stop the workflow before Telegram.

Category PNG lookup uses `asset-map.json`. Categories without exact artwork use the approved `News` badge; the source category stays in the item for records. An author must match a PNG name after case/spacing normalization. If it does not, no author image is drawn. Other logos and Montserrat fonts come from the supplied prototype assets.

Headline rules are enforced again in the renderer: uppercase, at most 12 words and 80 characters; subheadline at most 20 words. Both remain limited to two lines and Playwright measures them using the supplied Montserrat fonts. Following the 20 images in `~/Downloads/REFF Feed OZ `, both text blocks are right-aligned on the same edge. Headline size varies with length; subheadline uses a smaller 24–28 px range so the headline stays dominant. The subheadline and lower brand assets stay at fixed vertical anchors; the red panel grows upward for larger headlines. If a string cannot fit in two lines at its minimum font size, or the text box exceeds its maximum height, the renderer returns a visible error rather than truncating with an ellipsis.

The renderer accepts JPEG, PNG, and WebP photos only, limits each request to 16 MB and 50 megapixels, serializes rendering, and does not fetch any user-provided URL. The health check is `GET /healthz`.

A sample render from the Formula 1 article is in `previews/oz-222814-formula1-preview.jpg`. The latest short, regular, and long headline checks are in `previews/oz-reference-short.jpg`, `oz-reference-regular.jpg`, and `oz-reference-long.jpg`.

## Deployment files

- `Dockerfile` pins the matching Playwright base image and package version.
- `compose.renderer.yaml` joins only the existing private Docker network and does not publish a port.
- `server.mjs` validates the request, picks the brand assets, lays out text, and returns JPEG bytes.

Copy this folder to `~/n8n/renderer/`; run Compose with both existing `~/n8n/compose.yaml` and `~/n8n/renderer/compose.renderer.yaml`. Never edit `.env` to deploy it.
