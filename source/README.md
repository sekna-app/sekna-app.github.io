# SEKNA source

Working copies behind the site and the Apps Script backup.

| File | What it is |
| --- | --- |
| Index.source.html | The UI as edited (comments kept). |
| Index.html | The same UI made safe for Apps Script: `node build_deploy.js Index.source.html Index.html` (needs acorn). |
| Code.gs | The Apps Script backend (backup only; the SEKNA server in functions/ does the work). |
| build_web.py | Builds the site page from Index.html: `python3 build_web.py Index.html ../index.html`. |
| build_deploy.js | See Index.html above. |

Apps Script update: paste Code.gs and Index.html, then Deploy → New version.
No keys or passwords live here; they stay in GitHub Secrets, Secret Manager and Apps Script properties.
