---
name: hemera-style
description: Use whenever building any visual output — a dashboard, report, presentation/slides, web page, email, chart, card, poster or mockup — that should look like the HEMERA / Goldline Studio house style (deep navy and gold, white cards, big clear numbers). Triggers on "HEMERA style", "our style", "Goldline style", "house style", "navy and gold", or any request for a dashboard/deck/report for the team when no other brand is named. Gives exact colours, fonts, sizes, components and motion. Never adds a logo or brand name unless asked.
---

# HEMERA house style

Calm, premium, data-first. Deep navy and warm gold, white rounded cards, one big number per card, small spaced-caps labels, thin gold lines. Clear before clever.

## Hard rules
- **No logos, wordmarks or brand names** (no HEMERA, Goldline, SEKNA, hM mark, G mark) unless the user asks for them. The style alone carries the identity.
- **No emoji in the interface.** Use thin line icons (stroke 1.8–2.2, round caps and joins), gold or navy.
- Numbers in English digits with thousand separators: `$203,000`, `4.43x`, `88.4%`. Money with its currency sign. ROAS as `2.66x`.
- Works at 360px wide first, then desktop. Respect safe areas on phones.
- Light theme by default (soft grey page, white cards). Hero blocks and splash/cover screens are navy.

## Colour tokens (use exactly)
```css
:root{
  /* navy */
  --navy:#203C8E;        /* primary: buttons, headers, active tabs, icons */
  --navy-2:#2C4FB8;      /* lighter end of gradients */
  --navy-3:#16296E;      /* deep */
  --navy-4:#132457;      /* deeper */
  --navy-5:#0A1748;      /* darkest, page backgrounds of navy screens */
  --blue:#3B6CF5;        /* selection, focus, highlights */
  /* gold */
  --gold:#E2B874;        /* accent, lines, active dots, kickers on navy */
  --gold-2:#F2D38F;      /* light gold, gradient start */
  --gold-3:#C28D3E;      /* gradient end */
  --gold-ink:#B0812E;    /* gold text on white (readable) */
  /* neutrals */
  --page:#F4F6FB;        /* page background (alt #EEF1F7) */
  --card:#FFFFFF;
  --ink:#141B33;         /* main text */
  --ink-2:#6B7385;       /* secondary text */
  --ink-3:#8A93A8;       /* labels, captions */
  --line:#DFE4EF;        /* borders */
  --line-2:#EEF1F6;      /* row dividers */
  --on-navy:#FFFFFF; --on-navy-2:#C9D3F5; --on-navy-3:#9FB0E6;
  /* status (text / background) */
  --good:#13804F; --good-bg:#E3F6EC; --good-on-navy:#7EF0B9;
  --warn:#B9770E; --warn-bg:#FDF1D8; --warn-on-navy:#F2D38F;
  --bad:#C63A4A;  --bad-bg:#FBDDE1;  --bad-on-navy:#FF9AA6;
  /* series (always the same order and colour) */
  --s1:#7B5CF0; --s2:#2453D6; --s3:#C99A45; --s4:#1D9CC8; --s5:#E05566;
  /* three-part score (e.g. accuracy: spend 40 / conv 20 / value 40) */
  --p-spend:#7C5CFF; --p-conv:#3AA0F0; --p-value:#1FB98A;
}
```
Dark mode (only when asked): page `#0D1430`, card `#16204A`, text `#E7EBF3`, secondary `#9AA4C2`, line `#26326A`, gold `#E2B874`.

### Gradients
- Navy hero card: `linear-gradient(140deg,#203C8E,#2C4FB8)` or `linear-gradient(150deg,#2C4FB8,#16296E)`.
- Navy card header bar: `radial-gradient(120% 220% at 0 0,#2C4FB8,#203C8E 60%,#132457)`.
- Full navy screen / cover slide: `radial-gradient(90% 55% at 50% 42%,#223A86 0%,#15265F 45%,#0A1238 100%)`.
- Gold fill (bars, buttons): `linear-gradient(90deg,#E2B874,#F3D79F)`; gold text: `linear-gradient(90deg,#F2D38F,#E2B874 50%,#C28D3E)` clipped to text.
- Thin gold divider: 2–3px, `linear-gradient(90deg,transparent,#E2B874,transparent)`.

## Type
Google Fonts: `Inter` (500–900), `DM Serif Display` (400), `Space Grotesk` (700/800), and `Changa` for Arabic.
- **Numbers & UI:** Inter, weight 800–900, `letter-spacing:-.02em`, `font-variant-numeric:tabular-nums`.
- **Big page titles / hero headlines:** DM Serif Display 400, tight line-height (1.02–1.1). One word may be gold, or carry a soft gold highlight under it.
- **Labels / kickers:** UPPERCASE, 10–11px, weight 800–900, `letter-spacing:.06em–.14em` (up to .3em for covers), colour `--ink-3` (or `--on-navy-2` / gold on navy).
- **Spaced brand-like caps** (taglines on covers, e.g. "DAY BY DAY"): Space Grotesk 700, 11px, `letter-spacing:.42em; padding-left:.42em`.
- Body: Inter 500–600, 13–15px, line-height 1.5–1.65, `--ink-2`.
- Arabic text uses Changa; Arabic UI is RTL but number rows and charts stay LTR.

Scale: kicker 10–11 · label 12 · body 14 · card number 22–28 · hero number 36–48 · page title 27–34 (mobile) / 34–64 (desktop/cover).

## Shape & space
- Radius: cards 16–20px, inner tiles 12–14px, buttons 12–16px, pills 99px.
- Card: `background:#fff; border:1px solid var(--line) (optional); border-radius:18px; box-shadow:0 10px 26px rgba(20,40,110,.08); padding:16px`.
- Gaps 12px between cards, 16px inside. Page side padding 16px mobile, 24–26px desktop, content max-width ~1220–1480px.
- Coloured top edge for status on a card: 3px top border in good/warn/bad.

## Components
- **KPI card:** kicker label (caps, grey) · big number · small "target / of plan" line · thin progress bar (6–8px, radius 99, track `#EEF1F6`, fill navy/gold/green) with a small tick for the target.
- **Navy hero card:** navy gradient, white big number, labels `#C9D3F5`, bars in gold, status values in the on-navy status colours.
- **Pills/chips:** 11–12px bold, radius 99, padding 3–10px; good/warn/bad use the bg+text pairs above; neutral `#EEF2FB` + navy text.
- **Segmented tabs:** grey track `#F1F3F8`, active segment white (or navy with white text), 3px padding, radius 10–12.
- **Buttons:** primary navy `#203C8E` white text; accent gold gradient with `#0F1F52` text; secondary white with 1px line border, navy text.
- **Tables:** header caps 9.5–10px grey; rows 12.5–13px weight 800, thin `#EEF1F6` dividers, numbers right-aligned, first column left; % column coloured by status.
- **Series swatches:** 8px rounded squares in the series colours before each name.
- **Section header:** small rounded icon tile (`#EEF2FB` bg, navy line icon) + bold title 15–17px + optional caps subtitle.
- **Gold line accent:** a thin gold line under a hero title, or along the very top of a navy screen.

## Charts (dashboards)
- Bars rounded top (radius 4–6), navy `#203C8E` with the highlighted/best bar in gold `#E2B874`; secondary bars `#3D6BFF`.
- Lines 2.5–3px, navy or gold; target as a dashed grey line. Area fills ≤15% opacity.
- Gridlines faint `#EEF1F6`, no chart borders, labels 10–11px `--ink-3`. Value labels on top in 11px bold.
- Up/down: green ▲ / red ▼ with the status colours. Never rainbow palettes; use the series tokens in order.
- Ring/gauge: 8–10px stroke, track `#EEF0F5`, fill green/gold/navy, centred number 20–28px bold.

## Presentations / slides
- 16:9. Cover and section slides navy (full navy gradient), content slides `#F4F6FB` with white cards.
- Cover: kicker in gold caps → DM Serif Display headline (one phrase gold) → one-line subtitle `#C9D3F5` → thin gold divider. No logo.
- One idea per slide: a headline that states the takeaway, then 1–4 KPI cards or one chart. Big numbers, few words.
- Footer (optional): page number + date in 10px caps grey.
- Closing slide navy, mirror of the cover.

## Motion (when interactive)
- Ease `cubic-bezier(.2,.8,.2,1)` for things arriving, `.65,0,.2,1` for things moving between places.
- Enter: fade + rise 8px, 0.3–0.5s, stagger 50–70ms.
- Bars grow from the bottom, rings and lines draw in (stroke-dashoffset), gold dividers scale from the centre.
- Respect `prefers-reduced-motion`: fades only.

## Writing
Short and plain. Titles state the point ("Spend is 7% behind plan"), labels are 1–3 words, numbers carry the story. British-neutral English unless the user writes Arabic.

## Starter
For a quick start, copy `tokens.css` (next to this file) into the page and build with the classes there.
