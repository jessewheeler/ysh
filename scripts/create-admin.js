#!/usr/bin/env node

const email = process.argv[2];
const role = process.argv[3] || 'super_admin';
const first_name = process.argv[4] || email;
const last_name = process.argv[5] || '';

if (!email) {
  console.error('Usage: node scripts/create-admin.js <email> [role] [first_name] [last_name]');
  console.error('  role: super_admin (default) or editor');
  process.exit(1);
}

if (!['super_admin', 'editor'].includes(role)) {
  console.error('Invalid role. Must be "super_admin" or "editor".');
  process.exit(1);
}

require('dotenv').config();
const migrate = require('../db/migrate');
async function run() {
  await migrate();

  const db = require('../db/database');

  try {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await db.get('SELECT id FROM members WHERE email = ?', normalizedEmail);
    if (existing) {
      await db.run("UPDATE members SET role = ?, updated_at = datetime('now') WHERE id = ?", role, existing.id);
      console.log(`Existing member promoted to admin: ${normalizedEmail} (${role})`);
    } else {
      await db.run('INSERT INTO members (first_name, last_name, email, role) VALUES (?, ?, ?, ?)',
        first_name.trim(), last_name.trim(), normalizedEmail, role
      );
      console.log(`Admin created: ${normalizedEmail} (${role})`);
    }
    await db.close();
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

run();
