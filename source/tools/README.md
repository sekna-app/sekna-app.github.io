# Test helpers (not published)

Run from this folder after building (`cd source && NODE_PATH=/opt/node-tools/node_modules node build_deploy.js Index.source.html Index.html && python3 build_web.py Index.html ../index.html`).

Before a file:// test, copy the images next to the build, and delete them before committing:
`cp -r ../../icons ../icons; mkdir -p ../get; cp ../../get/logo-white.webp ../get/` … `rm -rf ../icons ../get`

- `setup.txt` — sample data put into the page (`eval` by shots2.js). No real data, no keys.
- `shots2.js` — `page(browser,w,h,scale)`, `go(page,fn)` and `warm(page)`; `node shots2.js phone|desk` writes `shots2/*.png`.
- `nav.js` — the phone bottom bar on its own (download page overlays).
- `shots3.js` — Reports Studio and desktop shots with sample daily data (download page).
- Playwright: `require('/opt/node-tools/node_modules/playwright')`; for html2canvas tests add `--allow-file-access-from-files`.
