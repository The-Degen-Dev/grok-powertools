# Web Smoke

## HEAD http://localhost:3001/
HTTP/1.1 200 OK
Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding
link: </_next/static/media/797e433ab948586e-s.p.479bea2b.woff2>; rel=preload; as="font"; crossorigin=""; type="font/woff2", </_next/static/media/caa3a2e1cccd8315-s.p.3b6cae6d.woff2>; rel=preload; as="font"; crossorigin=""; type="font/woff2"
Cache-Control: no-store, must-revalidate
X-Powered-By: Next.js
Content-Type: text/html; charset=utf-8
Date: Wed, 20 May 2026 01:36:36 GMT
Connection: keep-alive
Keep-Alive: timeout=5


## HEAD http://localhost:3001/collections
HTTP/1.1 307 Temporary Redirect
Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding
link: </_next/static/media/797e433ab948586e-s.p.479bea2b.woff2>; rel=preload; as="font"; crossorigin=""; type="font/woff2", </_next/static/media/caa3a2e1cccd8315-s.p.3b6cae6d.woff2>; rel=preload; as="font"; crossorigin=""; type="font/woff2"
location: /
Cache-Control: no-store, must-revalidate
X-Powered-By: Next.js
Content-Type: text/html; charset=utf-8
Date: Wed, 20 May 2026 01:36:37 GMT
Connection: keep-alive
Keep-Alive: timeout=5


## HEAD http://localhost:3001/edit
HTTP/1.1 200 OK
Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding
link: </_next/static/media/797e433ab948586e-s.p.479bea2b.woff2>; rel=preload; as="font"; crossorigin=""; type="font/woff2", </_next/static/media/caa3a2e1cccd8315-s.p.3b6cae6d.woff2>; rel=preload; as="font"; crossorigin=""; type="font/woff2"
Cache-Control: no-store, must-revalidate
X-Powered-By: Next.js
Content-Type: text/html; charset=utf-8
Date: Wed, 20 May 2026 01:36:37 GMT
Connection: keep-alive
Keep-Alive: timeout=5


## HEAD http://localhost:3001/movie
HTTP/1.1 200 OK
Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding
link: </_next/static/media/797e433ab948586e-s.p.479bea2b.woff2>; rel=preload; as="font"; crossorigin=""; type="font/woff2", </_next/static/media/caa3a2e1cccd8315-s.p.3b6cae6d.woff2>; rel=preload; as="font"; crossorigin=""; type="font/woff2"
Cache-Control: no-store, must-revalidate
X-Powered-By: Next.js
Content-Type: text/html; charset=utf-8
Date: Wed, 20 May 2026 01:36:37 GMT
Connection: keep-alive
Keep-Alive: timeout=5


## HEAD http://localhost:3001/share
HTTP/1.1 200 OK
Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding
link: </_next/static/media/797e433ab948586e-s.p.479bea2b.woff2>; rel=preload; as="font"; crossorigin=""; type="font/woff2", </_next/static/media/caa3a2e1cccd8315-s.p.3b6cae6d.woff2>; rel=preload; as="font"; crossorigin=""; type="font/woff2"
Cache-Control: no-store, must-revalidate
X-Powered-By: Next.js
Content-Type: text/html; charset=utf-8
Date: Wed, 20 May 2026 01:36:37 GMT
Connection: keep-alive
Keep-Alive: timeout=5

## Browser Screenshot Pass

- Dashboard: rendered after dismissing the first-run onboarding modal; screenshot `screenshots/web-dashboard.png`.
- Dashboard onboarding: first-run modal appears and blocks the dashboard until dismissed; reference screenshot `screenshots/web-dashboard-onboarding.png`.
- Collections: `http://localhost:3001/collections` redirects to `/`, so the screenshot is the dashboard empty state; screenshot `screenshots/web-collections.png`.
- Edit: rendered the Clip Editor empty/no-video state; screenshot `screenshots/web-edit.png`.
- Movie: rendered the Movie Maker empty state; screenshot `screenshots/web-movie.png`.
- Share: rendered a clear missing-data state for a URL without share payload; screenshot `screenshots/web-share.png`.
- Screenshot handling: the Next.js dev overlay indicator was removed before capture because it is not product UI and otherwise obscures bottom-left controls in the editor.

## Visual/UX Notes

- Dashboard: clean empty state with `New Collection` and `Load Examples`; first-run onboarding is clear, but it hides the dashboard during initial smoke.
- Collections: route exists only as a redirect to `/`; there is no distinct `/collections` workspace screen in this state.
- Edit: nonblank, full-screen editor shell renders, but it is unusable until a Grok video URL is loaded. The disabled/low-contrast controls read as intentionally inactive.
- Movie: empty movie list renders cleanly with `New Movie` actions.
- Share: missing share data is handled with `Invalid Share Link` and `Go to Collections`.

## Console/Runtime Notes

- Browser console errors repeated on all tested routes:
  - `GET /api/auth/session` returned `500 Internal Server Error`.
  - `https://cdn.jsdelivr.net/gh/nicholasgillespie/fonts@main/satoshi/Satoshi-Variable.woff2` returned `404`.
- Direct endpoint check for `/api/auth/session` returned `{"message":"There was a problem with the server configuration. Check the server logs for more information."}`.
- No Playwright page exceptions were observed during route capture.
