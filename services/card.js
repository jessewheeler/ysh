const PDFDocument = require('pdfkit');
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');
const db = require('../db/database');

const CARD_WIDTH = 1050;
const CARD_HEIGHT = 600;
const NAVY = '#002a5c';
const GREEN = '#69be28';
const WHITE = '#ffffff';

const cardsDir = path.join(__dirname, '..', 'data', 'cards');

function ensureCardsDir() {
  if (!fs.existsSync(cardsDir)) fs.mkdirSync(cardsDir, { recursive: true });
}

// Try to load the logo image
async function getLogo() {
  const logoPath = path.join(__dirname, '..', 'public', 'img', 'logo.png');
  if (fs.existsSync(logoPath)) {
    return await loadImage(logoPath);
  }
  return null;
}

async function generatePNG(member) {
  ensureCardsDir();

  const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = WHITE;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // Navy top stripe (160px)
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, CARD_WIDTH, 160);

  // Logo
  try {
    const logo = await getLogo();
    if (logo) {
      ctx.drawImage(logo, 30, 20, 120, 120);
    }
  } catch (_e) { /* skip logo */ }

  // Title text on navy stripe
  ctx.fillStyle = WHITE;
  ctx.font = 'bold 42px Arial, sans-serif';
  ctx.fillText('YELLOWSTONE SEA HAWKERS', 170, 75);

  ctx.font = '22px Arial, sans-serif';
  ctx.fillStyle = GREEN;
  ctx.fillText('Official Member Card', 170, 115);

  // Member info on white body
  ctx.fillStyle = '#333333';
  ctx.font = 'bold 36px Arial, sans-serif';
  ctx.fillText(`${member.first_name} ${member.last_name}`, 60, 240);

  ctx.fillStyle = '#666666';
  ctx.font = '26px Arial, sans-serif';
  ctx.fillText(`Member #: ${member.member_number}`, 60, 300);
  ctx.fillText(`Season: ${member.membership_year}`, 60, 345);

  // Status badge
  if (member.status === 'active') {
    ctx.fillStyle = GREEN;
    ctx.font = 'bold 22px Arial, sans-serif';
    ctx.fillText('ACTIVE MEMBER', 60, 400);
  }

  // Green bottom accent bar (50px)
  ctx.fillStyle = GREEN;
  ctx.fillRect(0, CARD_HEIGHT - 50, CARD_WIDTH, 50);

  // "Go Hawks!" text
  ctx.fillStyle = WHITE;
  ctx.font = 'bold 24px Arial, sans-serif';
  ctx.fillText('Go Hawks!', CARD_WIDTH - 180, CARD_HEIGHT - 15);

  // Save PNG
  const filename = `card-${member.id}-${member.membership_year}.png`;
  const filePath = path.join(cardsDir, filename);
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(filePath, buffer);

  const relativePath = `data/cards/${filename}`;

  // Upsert card record
  const existing = db.prepare(
    'SELECT id FROM membership_cards WHERE member_id = ? AND year = ?'
  ).get(member.id, member.membership_year);

  if (existing) {
    db.prepare('UPDATE membership_cards SET png_path = ? WHERE id = ?').run(relativePath, existing.id);
  } else {
    db.prepare(
      'INSERT INTO membership_cards (member_id, png_path, year) VALUES (?, ?, ?)'
    ).run(member.id, relativePath, member.membership_year);
  }

  return filePath;
}

async function generatePDF(member) {
  ensureCardsDir();

  const filename = `card-${member.id}-${member.membership_year}.pdf`;
  const filePath = path.join(cardsDir, filename);

  return new Promise((resolve, reject) => {
    // PDF at 3.5" x 2" (252pt x 144pt) — scaled up for quality
    const doc = new PDFDocument({
      size: [525, 300],
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // Navy top stripe
    doc.rect(0, 0, 525, 80).fill(NAVY);

    // Logo
    const logoPath = path.join(__dirname, '..', 'public', 'img', 'logo.png');
    if (fs.existsSync(logoPath)) {
      try {
        doc.image(logoPath, 15, 10, { width: 60 });
      } catch (_e) { /* skip */ }
    }

    // Title
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(20)
      .text('YELLOWSTONE SEA HAWKERS', 85, 22, { width: 420 });
    doc.fillColor(GREEN).font('Helvetica').fontSize(11)
      .text('Official Member Card', 85, 52, { width: 420 });

    // White body
    doc.fillColor('#333333').font('Helvetica-Bold').fontSize(18)
      .text(`${member.first_name} ${member.last_name}`, 30, 100, { width: 465 });
    doc.fillColor('#666666').font('Helvetica').fontSize(13)
      .text(`Member #: ${member.member_number}`, 30, 130, { width: 465 });
    doc.text(`Season: ${member.membership_year}`, 30, 152, { width: 465 });

    if (member.status === 'active') {
      doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(11)
        .text('ACTIVE MEMBER', 30, 185, { width: 465 });
    }

    // Green bottom bar
    doc.rect(0, 275, 525, 25).fill(GREEN);
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(12)
      .text('Go Hawks!', 430, 279, { width: 80 });

    doc.end();

    stream.on('finish', () => {
      const relativePath = `data/cards/${filename}`;

      const existing = db.prepare(
        'SELECT id FROM membership_cards WHERE member_id = ? AND year = ?'
      ).get(member.id, member.membership_year);

      if (existing) {
        db.prepare('UPDATE membership_cards SET pdf_path = ? WHERE id = ?').run(relativePath, existing.id);
      } else {
        db.prepare(
          'INSERT INTO membership_cards (member_id, pdf_path, year) VALUES (?, ?, ?)'
        ).run(member.id, relativePath, member.membership_year);
      }

      resolve(filePath);
    });

    stream.on('error', reject);
  });
}

module.exports = { generatePDF, generatePNG };
