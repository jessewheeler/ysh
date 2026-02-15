const fs = require('fs');
const path = require('path');
const db = require('../db/database');

const MAILERSEND_API_KEY = process.env.MAILERSEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@yellowstoneseahawkers.com';

function getContactEmail() {
  const row = db.prepare("SELECT value FROM site_settings WHERE key = 'contact_email'").get();
  return row?.value || FROM_EMAIL;
}

function emailWrapper(bodyHtml) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0; padding:0; font-family: Arial, sans-serif; background:#f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;">
    <tr><td align="center" style="padding:20px 0;">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff; border-radius:8px; overflow:hidden;">
        <!-- Header -->
        <tr><td style="background:#002a5c; padding:20px 30px; text-align:center;">
          <h1 style="color:#fff; margin:0; font-size:22px;">Yellowstone Sea Hawkers</h1>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:30px;">
          ${bodyHtml}
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#f8f8f8; padding:15px 30px; text-align:center; font-size:12px; color:#999;">
          Yellowstone Sea Hawkers &bull; Billings, MT<br>
          A non-profit supporting the Seattle Seahawks and the NFL.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function logEmail({ to_email, to_name, subject, body_html, email_type, status, error, member_id }) {
  db.prepare(
    `INSERT INTO emails_log (to_email, to_name, subject, body_html, email_type, status, error, member_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(to_email, to_name || null, subject, body_html || null, email_type, status || 'sent', error || null, member_id || null);
}

async function mailersendSend({ to, toName, from, subject, html, attachments }) {
  const body = {
    from: { email: from.email, name: from.name },
    to: [{ email: to, name: toName || to }],
    subject,
    html,
  };
  if (attachments && attachments.length > 0) {
    body.attachments = attachments.map(a => ({
      content: a.content,
      filename: a.filename,
      disposition: a.disposition || 'attachment',
    }));
  }

  const res = await fetch('https://api.mailersend.com/v1/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MAILERSEND_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const errMsg = errBody.message || `HTTP ${res.status}`;
    throw new Error(errMsg);
  }
}

async function sendEmail({ to, toName, subject, html, email_type, member_id, attachments }) {
  const msg = {
    to,
    toName,
    from: { email: FROM_EMAIL, name: 'Yellowstone Sea Hawkers' },
    subject,
    html: emailWrapper(html),
  };
  if (attachments) msg.attachments = attachments;

  try {
    await mailersendSend(msg);
    logEmail({ to_email: to, to_name: toName, subject, body_html: html, email_type, status: 'sent', member_id });
  } catch (err) {
    const errMsg = err.message;
    console.error(`MailerSend error (${email_type}):`, errMsg);
    logEmail({ to_email: to, to_name: toName, subject, body_html: html, email_type, status: 'failed', error: errMsg, member_id });
    throw err;
  }
}

async function sendWelcomeEmail(member) {
  const html = `
    <h2 style="color:#002a5c;">Welcome to the Yellowstone Sea Hawkers!</h2>
    <p>Hi ${member.first_name},</p>
    <p>Thank you for joining the Yellowstone Sea Hawkers! We're thrilled to have you as a member.</p>
    <table style="margin:20px 0; font-size:14px;">
      <tr><td style="padding:5px 15px 5px 0; font-weight:bold;">Member Number:</td><td>${member.member_number}</td></tr>
      <tr><td style="padding:5px 15px 5px 0; font-weight:bold;">Season:</td><td>${member.membership_year}</td></tr>
      <tr><td style="padding:5px 15px 5px 0; font-weight:bold;">Status:</td><td style="color:#69be28; font-weight:bold;">Active</td></tr>
    </table>
    <p>Your membership card will be sent in a separate email. Look for us at the Red Door Lounge on game days!</p>
    <p style="color:#69be28; font-weight:bold; font-size:18px;">Go Hawks!</p>
  `;
  await sendEmail({
    to: member.email,
    toName: `${member.first_name} ${member.last_name}`,
    subject: 'Welcome to the Yellowstone Sea Hawkers!',
    html,
    email_type: 'welcome',
    member_id: member.id,
  });
}

async function sendPaymentConfirmation(member, stripeSession) {
  const amountDollars = stripeSession.amount_total
    ? (stripeSession.amount_total / 100).toFixed(2)
    : 'N/A';
  const html = `
    <h2 style="color:#002a5c;">Payment Confirmation</h2>
    <p>Hi ${member.first_name},</p>
    <p>We've received your membership dues payment. Here are your receipt details:</p>
    <table style="margin:20px 0; font-size:14px; border-collapse:collapse;">
      <tr><td style="padding:8px 15px 8px 0; font-weight:bold; border-bottom:1px solid #eee;">Amount:</td><td style="padding:8px 0; border-bottom:1px solid #eee;">$${amountDollars}</td></tr>
      <tr><td style="padding:8px 15px 8px 0; font-weight:bold; border-bottom:1px solid #eee;">Date:</td><td style="padding:8px 0; border-bottom:1px solid #eee;">${new Date().toLocaleDateString()}</td></tr>
      <tr><td style="padding:8px 15px 8px 0; font-weight:bold;">Member Number:</td><td style="padding:8px 0;">${member.member_number}</td></tr>
    </table>
    <p>Thank you for your support!</p>
  `;
  await sendEmail({
    to: member.email,
    toName: `${member.first_name} ${member.last_name}`,
    subject: 'Payment Confirmation — Yellowstone Sea Hawkers',
    html,
    email_type: 'payment_confirmation',
    member_id: member.id,
  });
}

async function sendCardEmail(member) {
  const card = db.prepare(
    'SELECT * FROM membership_cards WHERE member_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(member.id);

  if (!card) throw new Error('No card found for this member');

  const attachments = [];
  if (card.pdf_path) {
    const pdfFullPath = path.join(__dirname, '..', card.pdf_path);
    if (fs.existsSync(pdfFullPath)) {
      attachments.push({
        content: fs.readFileSync(pdfFullPath).toString('base64'),
        filename: `YSH-Membership-Card-${member.membership_year}.pdf`,
        type: 'application/pdf',
        disposition: 'attachment',
      });
    }
  }
  if (card.png_path) {
    const pngFullPath = path.join(__dirname, '..', card.png_path);
    if (fs.existsSync(pngFullPath)) {
      attachments.push({
        content: fs.readFileSync(pngFullPath).toString('base64'),
        filename: `YSH-Membership-Card-${member.membership_year}.png`,
        type: 'image/png',
        disposition: 'attachment',
      });
    }
  }

  const html = `
    <h2 style="color:#002a5c;">Your Membership Card</h2>
    <p>Hi ${member.first_name},</p>
    <p>Your ${member.membership_year} Yellowstone Sea Hawkers membership card is attached to this email in both PDF and PNG formats.</p>
    <p>Show it with pride at our next watch party!</p>
    <p style="color:#69be28; font-weight:bold; font-size:18px;">Go Hawks!</p>
  `;
  await sendEmail({
    to: member.email,
    toName: `${member.first_name} ${member.last_name}`,
    subject: `Your ${member.membership_year} YSH Membership Card`,
    html,
    email_type: 'card_delivery',
    member_id: member.id,
    attachments,
  });
}

async function sendBlastEmail(member, subject, bodyHtml) {
  await sendEmail({
    to: member.email,
    toName: `${member.first_name} ${member.last_name}`,
    subject,
    html: bodyHtml,
    email_type: 'blast',
    member_id: member.id,
  });
}

async function sendOtpEmail({ to, toName, otp }) {
  const html = `
    <h2 style="color:#002a5c;">Your Login Code</h2>
    <p>Hi ${toName},</p>
    <p>Your one-time login code is:</p>
    <p style="font-size:32px; font-weight:bold; letter-spacing:8px; color:#002a5c; text-align:center; margin:20px 0;">${otp}</p>
    <p>This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
  `;
  await sendEmail({
    to,
    toName,
    subject: 'Your YSH Admin Login Code',
    html,
    email_type: 'otp',
  });
}

async function sendContactEmail({ name, email, message }) {
  const contactTo = getContactEmail();
  const html = `
    <h2 style="color:#002a5c;">New Contact Form Submission</h2>
    <table style="margin:20px 0; font-size:14px;">
      <tr><td style="padding:5px 15px 5px 0; font-weight:bold; vertical-align:top;">From:</td><td>${name}</td></tr>
      <tr><td style="padding:5px 15px 5px 0; font-weight:bold; vertical-align:top;">Email:</td><td><a href="mailto:${email}">${email}</a></td></tr>
      <tr><td style="padding:5px 15px 5px 0; font-weight:bold; vertical-align:top;">Message:</td><td>${message.replace(/\n/g, '<br>')}</td></tr>
    </table>
  `;
  await sendEmail({
    to: contactTo,
    toName: 'YSH Admin',
    subject: `Contact Form: Message from ${name}`,
    html,
    email_type: 'contact',
  });
}

module.exports = {
  sendWelcomeEmail,
  sendPaymentConfirmation,
  sendCardEmail,
  sendBlastEmail,
  sendOtpEmail,
  sendContactEmail,
};
