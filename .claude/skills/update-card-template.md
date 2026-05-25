# Skill: update-card-template

Update the YSH membership card template for a new season.

## Instructions

Follow these steps exactly when asked to update the card template:

### 1. Locate the source PDF

Check `data/cards/` for the new season PDF (e.g. `YSH-Card26-27.pdf`).
If it is not there, ask the user to place it there before continuing.

### 2. Convert and crop

Run these commands to produce the committed template PNG:

```bash
gs -dNOPAUSE -dBATCH -sDEVICE=png16m -r300 \
  -sOutputFile=data/cards/raw-300dpi.png \
  data/cards/<PDF_FILENAME>

magick data/cards/raw-300dpi.png -trim -bordercolor white -border 20 \
  public/img/card-template.png

identify public/img/card-template.png
```

Read the output dimensions from `identify`.

### 3. Check dimensions

Read `public/img/card-template.png` as an image to confirm it looks correct
(no stray whitespace, full card visible, borders intact).

### 4. Update constants if dimensions changed

Open `services/card.js` and check `CARD_WIDTH` / `CARD_HEIGHT`.
If they differ from the `identify` output, update them.

### 5. Calibrate name field

Read the template image and estimate the pixel position of the blank
"Member Name:" underline. Update `NAME_X`, `NAME_Y`, and `NAME_FONT_SIZE`
in `services/card.js` as needed.

Current calibration reference (1008 × 557 template):

- `NAME_X = 300` — left edge of name text (after "Member Name:" label)
- `NAME_Y = 344` — canvas baseline — sits on the underline
- `NAME_FONT_SIZE = 36`

Adjustment guide:

- Name appears too far left → increase `NAME_X`
- Name appears too high → increase `NAME_Y`
- Name appears too small → increase `NAME_FONT_SIZE`

### 6. Run tests

```bash
npm test -- --testPathPattern=card
```

All tests should pass. If they fail, fix before proceeding.

### 7. Clean up and commit

```bash
rm data/cards/raw-300dpi.png
git add public/img/card-template.png services/card.js
git commit -m "chore: update membership card template for <XX-XX> season"
```

### 8. Report back

Tell the user:

- New template dimensions
- Whether name-field coordinates were changed and by how much
- That tests passed
- The commit hash

## Reference

Full human guide: `docs/card-template.md`
Card service: `services/card.js`
