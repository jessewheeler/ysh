# Plan: Charitable Work Section Expansion

## Context

The YSH homepage has a static "Charitable Activity" section with three hardcoded cards
(Report Charitable Activity → Office 365 form, Dog Tag Buddies, Family Services of Billings).
The club wants to rename this to **"Charitable Work"** and expand it into three dedicated
static sub-pages:

- **Battle of the Birds** — annual fundraiser benefiting Billings Family Service
- **Annual Non-Profit Support** — multi-year history ($10K+ total raised)
- **Heartwheels** — tribute to late member Taku, continued by Brenda (Hot Wheels for kids in cancer treatment)

All sub-pages are static Pug templates following the `bios.pug` pattern; Heartwheels photos
are static files in `public/img/heartwheels/`. The current branch is `feature/heartwheels-page`.

**Decisions confirmed with the user:**

1. **Scope = all three pages** plus the nav dropdown + homepage card restructure.
2. The general **"Report Charitable Activity"** Office 365 form moves into the **nav dropdown**
   (as an external link), not a homepage card and not buried in a single sub-page.

---

## Files to Modify

### `views/layout.pug` (line 23)

Replace `li: a(href="/#charitable") Charitable Activity` with a `.dropdown` block mirroring the
existing "About YSH" dropdown (`layout.pug:17-20`). The toggle links to `/#charitable` (parallel
to the About toggle linking to `/#about`):

```pug
li.dropdown
  a.dropdown-toggle(href="/#charitable") Charitable Work
  ul.dropdown-menu
    li: a(href="/charitable/battle-of-the-birds") Battle of the Birds
    li: a(href="/charitable/nonprofits") Annual Non-Profit Support
    li: a(href="/charitable/heartwheels") Heartwheels
    li: a(href="https://forms.office.com/r/0HGbiXg01L" target="_blank") Report Charitable Activity
```

> Note: the dropdown opens on `:hover` even in the mobile media query (`style.css:595`) — this is
> the existing "About YSH" behavior, not a new regression. Sub-pages remain reachable via the
> homepage cards regardless.

### `views/index.pug` (lines 84-104)

- Change `h2 Charitable Activity` → **`h2 Charitable Work`**.
- Replace the three existing cards with three cards linking to the new sub-pages (each using
  `a.btn-outline` with an internal href, no `target="_blank"`):
    1. **Battle of the Birds** — "Our annual fundraiser benefiting Billings Family Service" →
       `/charitable/battle-of-the-birds`
    2. **Annual Non-Profit Support** — "Over $10,000 raised for local charities" → `/charitable/nonprofits`
    3. **Heartwheels** — "Bringing joy to kids undergoing cancer treatment" → `/charitable/heartwheels`
- The "Report Charitable Activity" form link is **not** a homepage card — it lives in the nav dropdown.

### `routes/index.js`

Add three GET routes after the `/bios` handler. Static content, no DB calls — follow the simple
`res.render()` style of `/membership/success` (`routes/index.js:127`), no try/catch needed:

```js
router.get('/charitable/battle-of-the-birds', (_req, res) => res.render('charitable/battle-of-the-birds'));
router.get('/charitable/nonprofits', (_req, res) => res.render('charitable/nonprofits'));
router.get('/charitable/heartwheels', (_req, res) => res.render('charitable/heartwheels'));
```

---

## New Files

All three extend `layout` + define `block content` (see `bios.pug:1-3`) and reuse existing
CSS classes: `.section`, `.alt-bg`, `.container`, `.cards`, `.cards-three`, `.card`, `.card-body`,
`.btn`, `.btn-outline`, `.gallery-grid` (all confirmed present in `public/css/style.css`).

### `views/charitable/battle-of-the-birds.pug`

- "What is Battle of the Birds?" — description of the annual fundraiser.
- Link to Billings Family Service (https://billingsfamilyservice.org/).
- Card/section on how to participate.

### `views/charitable/nonprofits.pug`

- Prominent stat: **Over $10,000 raised for local charities**.
- Year-by-year `.cards` layout:
    - **2024** — Yellowstone Valley Animal Shelter
    - **2025** — Dog Tag Buddies (https://www.dogtagbuddies.org, donate: https://tinyurl.com/DogTag-Buddies)
    - **2026** — "To Be Announced" (kept as an easily-editable placeholder in the template)

### `views/charitable/heartwheels.pug`

- Tribute section for Taku (brief bio / mission), noting Brenda continues the work. Respectful tone.
- Photo grid using `.gallery-grid`, referencing `/img/heartwheels/photo-1.jpg` etc.
- "How to Support" section — placeholder copy until the user provides final drop-off/delivery text.

### `public/img/heartwheels/` (new directory)

- Currently absent. Created to hold Taku's photos. **User action required** to add the images
  before the page goes live; until then the `.gallery-grid` `img` references will 404.

---

## Reused Patterns

- Nav dropdown markup + CSS: "About YSH" dropdown in `layout.pug:17-20` / `.dropdown` rules at `style.css:103-122`
- Page template: `extends layout` + `block content` from `views/bios.pug`
- Static route style: `/membership/success`, `/contact/success` in `routes/index.js`
- Card grid: `.cards` / `.cards-three` as used in the homepage `#membership` and `#charitable` sections

---

## Verification

1. `npm run dev` → homepage `#charitable` heading reads **"Charitable Work"** with 3 sub-page cards.
2. Nav "Charitable Work" dropdown shows 4 items (3 sub-pages + external Report Charitable Activity); the external item
   opens in a new tab.
3. Click each homepage card → corresponding sub-page renders correctly.
4. Toggle mobile nav (`nav.js`) → menu opens; dropdown items are reachable.
5. `npm run lint` → no errors.
6. `npm test` → ~320 tests still pass (no test changes expected; confirm no regressions).

---

## Open Content Items (non-blocking)

- Heartwheels photos must be added to `public/img/heartwheels/` before launch.
- Heartwheels "How to Support" copy is placeholder pending final text.
- Nonprofits 2026 org shown as "To Be Announced" until decided — trivially editable in the template.
