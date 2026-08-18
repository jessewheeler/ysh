const PDFDocument = require('pdfkit');
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const {PassThrough} = require('stream');
const path = require('path');
const cardsRepo = require('../db/repos/cards');
const storage = require('./storage');
const db = require('../db/database');
const logger = require('./logger');

// Template-based card design — the background PNG is the official Sea Hawkers
// membership card for the current season.  Only the member's name is stamped
// on top.  To update for a new season see docs/card-template.md.
const TEMPLATE_PNG = path.join(__dirname, '..', 'public', 'img', 'card-template.png');

// Canvas dimensions must match the template PNG exactly.
const CARD_WIDTH = 1008;
const CARD_HEIGHT = 557;

const NAVY = '#002a5c';

// ── Name-field calibration ────────────────────────────────────────────────────
// These pixel coordinates point at the blank "Member Name:" underline on the
// 1008×557 template.  If you replace the template PNG, re-calibrate these by
// following the steps in docs/card-template.md.
const NAME_X = 300;            // left edge of name text (after "Member Name:" label)
const NAME_Y = 344;            // canvas baseline — sits on the underline
const NAME_MAX_WIDTH = 680;    // clip before right border
const NAME_FONT_SIZE = 36;     // px — tweak to taste
// ─────────────────────────────────────────────────────────────────────────────

// PDF output dimensions (0.5× of the 1008×557 template)
const PDF_SCALE = 0.5;
const PDF_WIDTH = Math.round(CARD_WIDTH * PDF_SCALE);   // 504
const PDF_HEIGHT = Math.round(CARD_HEIGHT * PDF_SCALE); // 279

// Legacy home for per-period templates: before issue #96 they were written straight
// into the served static directory, which a deploy wipes.  Rows written back then
// still hold a bare filename that resolves here.
const CARD_TEMPLATE_DIR = path.join(__dirname, '..', 'public', 'img');
const LOCAL_UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');

// Reads whatever `membership_periods.card_template_path` holds into a buffer.  Three
// forms are in play: a B2 URL (what uploads produce now), a `/uploads/<name>` path
// (the no-B2 local fallback), and a bare filename (pre-#96 rows).
async function loadTemplate(templatePath) {
  if (/^https?:\/\//.test(templatePath)) {
    const res = await fetch(templatePath);
    if (!res.ok) throw new Error(`fetch returned ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const dir = templatePath.startsWith('/uploads/') ? LOCAL_UPLOAD_DIR : CARD_TEMPLATE_DIR;
  return fs.readFileSync(path.join(dir, path.basename(templatePath)));
}

async function resolveTemplateBuffer(memberId) {
  const row = await db.get(
    `SELECT mp.card_template_path
     FROM membership_years my
     JOIN membership_periods mp ON mp.id = my.membership_period_id
     WHERE my.member_id = ?
     ORDER BY mp.start_date DESC
     LIMIT 1`,
    memberId
  );
  if (row?.card_template_path) {
    try {
      return await loadTemplate(row.card_template_path);
    } catch (err) {
      // Fall back to the default template if the period's configured template is
      // unreachable — otherwise card generation throws and the renewal silently
      // ships no card (issue #67).  Warn loudly: a silent fallback is what hid
      // the deploy-wipes-the-template bug for a whole release cycle (issue #96).
      logger.warn('Card template unavailable, using default', {
        memberId, cardTemplatePath: row.card_template_path, error: err.message,
      });
    }
  }
  return fs.readFileSync(TEMPLATE_PNG);
}

const cardsDir = path.join(__dirname, '..', 'data', 'cards');

function ensureCardsDir() {
  if (!fs.existsSync(cardsDir)) fs.mkdirSync(cardsDir, { recursive: true });
}

async function generatePNG(member) {
  const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
  const ctx = canvas.getContext('2d');

    const template = await loadImage(await resolveTemplateBuffer(member.id));
    ctx.drawImage(template, 0, 0, CARD_WIDTH, CARD_HEIGHT);

    // Stamp member name on the blank "Member Name:" field
  ctx.fillStyle = NAVY;
    ctx.font = `bold ${NAME_FONT_SIZE}px Arial, sans-serif`;
    ctx.fillText(`${member.first_name} ${member.last_name}`, NAME_X, NAME_Y, NAME_MAX_WIDTH);

  const filename = `card-${member.id}-${member.membership_year}.png`;
  const buffer = canvas.toBuffer('image/png');

    if (storage.isConfigured()) {
        const url = await storage.uploadFileAtKey(buffer, `cards/${filename}`, 'image/png');
        await cardsRepo.upsertPng(member.id, member.membership_year, url);
        return url;
    }

    ensureCardsDir();
    const filePath = path.join(cardsDir, filename);
  fs.writeFileSync(filePath, buffer);
  const relativePath = `data/cards/${filename}`;
  await cardsRepo.upsertPng(member.id, member.membership_year, relativePath);
  return filePath;
}

async function generatePDF(member) {
  const filename = `card-${member.id}-${member.membership_year}.pdf`;
  const templateBuffer = await resolveTemplateBuffer(member.id);

    const buffer = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({
        size: [PDF_WIDTH, PDF_HEIGHT],
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });

        const chunks = [];
        const pass = new PassThrough();
        doc.pipe(pass);
        pass.on('data', chunk => chunks.push(chunk));
        pass.on('end', () => resolve(Buffer.concat(chunks)));
        pass.on('error', reject);

        // Draw official template as background
        doc.image(templateBuffer, 0, 0, {width: PDF_WIDTH, height: PDF_HEIGHT});

        // Stamp member name — PDFKit y is top-of-text, so subtract font ascent
        const pdfFontSize = NAME_FONT_SIZE * PDF_SCALE;
        const pdfNameX = NAME_X * PDF_SCALE;
        const pdfNameY = (NAME_Y - NAME_FONT_SIZE) * PDF_SCALE;

        doc.fillColor(NAVY)
            .font('Helvetica-Bold')
            .fontSize(pdfFontSize)
            .text(
                `${member.first_name} ${member.last_name}`,
                pdfNameX,
                pdfNameY,
                {width: NAME_MAX_WIDTH * PDF_SCALE, lineBreak: false}
            );

    doc.end();
    });

    if (storage.isConfigured()) {
        const url = await storage.uploadFileAtKey(buffer, `cards/${filename}`, 'application/pdf');
        await cardsRepo.upsertPdf(member.id, member.membership_year, url);
        return url;
    }

    ensureCardsDir();
    const filePath = path.join(cardsDir, filename);
    fs.writeFileSync(filePath, buffer);
    const relativePath = `data/cards/${filename}`;
    await cardsRepo.upsertPdf(member.id, member.membership_year, relativePath);
    return filePath;
}

module.exports = { generatePDF, generatePNG };
