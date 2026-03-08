#!/usr/bin/env node
'use strict';

/**
 * Import 2025-26 membership signups from CSV.
 *
 * Usage:
 *   node scripts/import-csv.js [--dry-run]
 *
 * Works with SQLite (default) and PostgreSQL (when DATABASE_URL is set).
 * Idempotent: skips members whose email already exists as a primary member.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const CSV_PATH = path.join(
    __dirname, '..', 'data',
    '25-26 Membership Signup form results(2025-26 Membership).csv'
);
const MEMBERSHIP_YEAR = 2025;
const EXPIRY_DATE = '2026-09-01';

// ─── CSV parser ───────────────────────────────────────────────────────────────
// Handles quoted fields (with embedded commas and newlines) and escaped quotes.
function parseCSV(text) {
    const rows = [];
    let i = 0;
    const n = text.length;

    while (i < n) {
        const row = [];

        while (i < n) {
            let field = '';

            if (text[i] === '"') {
                // Quoted field
                i++;
                while (i < n) {
                    if (text[i] === '"') {
                        if (i + 1 < n && text[i + 1] === '"') {
                            field += '"';
                            i += 2;
                        } else {
                            i++; // consume closing quote
                            break;
                        }
                    } else {
                        field += text[i++];
                    }
                }
            } else {
                // Unquoted field: read until comma or line ending
                while (i < n && text[i] !== ',' && text[i] !== '\r' && text[i] !== '\n') {
                    field += text[i++];
                }
            }

            row.push(field.trim());

            if (i < n && text[i] === ',') {
                i++;
            } else {
                break;
            }
        }

        if (i < n && text[i] === '\r') i++;
        if (i < n && text[i] === '\n') i++;

        if (row.some(f => f !== '')) rows.push(row);
    }

    return rows;
}

// ─── Date parsing ─────────────────────────────────────────────────────────────
// Accepts M/D/YY, M/D/YYYY, or a bare 4-digit year (→ Jan 1 of that year).
// Returns an ISO date string or null for unparseable text.
function parseDate(str) {
    if (!str || !str.trim()) return null;
    str = str.trim();

    if (/^\d{4}$/.test(str)) return `${str}-01-01`;

    const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
        const month = m[1].padStart(2, '0');
        const day = m[2].padStart(2, '0');
        const rawY = parseInt(m[3], 10);
        const year = m[3].length === 2 ? (rawY <= 30 ? 2000 + rawY : 1900 + rawY) : rawY;
        return `${year}-${month}-${day}`;
    }

    return null; // e.g. "Charter member", "Yes", "Na"
}

// ─── Payment parsing ──────────────────────────────────────────────────────────
// The Family (col 15) and Individual (col 16) cells contain text like
// "Cash ($25)", "Venmo ($16)", etc.
function parsePayment(familyCell, indivCell) {
    const cell = (familyCell || indivCell || '').trim();
    if (!cell) return null;

    const amountMatch = cell.match(/\$(\d+(?:\.\d{2})?)/);
    const amount_cents = amountMatch ? Math.round(parseFloat(amountMatch[1]) * 100) : null;

    let payment_method = 'other';
    if (/cash/i.test(cell)) payment_method = 'cash';
    else if (/venmo/i.test(cell)) payment_method = 'venmo';
    else if (/paypal/i.test(cell)) payment_method = 'paypal';
    else if (/check/i.test(cell)) payment_method = 'check';

    return {amount_cents, payment_method};
}

// ─── Family member name parsing ───────────────────────────────────────────────
// Splits the free-form "Family members" text into name objects.
// Skips entries that match the primary member's first name.
function parseFamilyMembers(text, primaryFirst, primaryLast) {
    if (!text || !text.trim()) return [];

    const parts = text
        .split(/,|\s+and\s+|\s*&\s*/i)
        .map(s => s.replace(/\([^)]*\)/g, '').trim()) // strip "(wife)", etc.
        .filter(s => s && !/^\d+$/.test(s));           // drop empty / pure numbers

    const results = [];
    for (const part of parts) {
        const words = part.split(/\s+/).filter(Boolean);
        if (!words.length) continue;

        const firstName = words[0];
        // Skip if this token is the primary member
        if (firstName.toLowerCase() === primaryFirst.toLowerCase()) continue;

        const lastName = words.length > 1 ? words.slice(1).join(' ') : primaryLast;
        results.push({first_name: firstName, last_name: lastName});
    }

    return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    if (DRY_RUN) console.log('=== DRY RUN — no changes will be written ===\n');

    const migrate = require('../db/migrate');
    await migrate();

    const db = require('../db/database');
    const {generateMemberNumber} = require('../services/members');
    const paymentRepo = require('../db/repos/payments');
    const auditLog = require('../db/repos/auditLog');

    // ── Parse CSV ───────────────────────────────────────────────────────────────
    const text = fs.readFileSync(CSV_PATH, 'utf-8');
    const rows = parseCSV(text);
    // Row 0 = group labels, Row 1 = column headers, Rows 2+ = data
    const headers = rows[1];
    const dataRows = rows.slice(2);

    // Build header→index map for documentation; fall back to known positions.
    const colIdx = {};
    headers.forEach((h, i) => {
        colIdx[h] = i;
    });

    // Column indices (verified against sample rows)
    const C = {
        signupDate: 1,
        firstName: 2,
        lastName: 3,
        email: 4,
        address: 5,
        city: 6,
        state: 7,
        zip: 8,
        phone: 9,
        membershipType: 10,
        familyMembers: 13,
        familyPayment: 15,  // "Family" col — "Cash ($25)", "Venmo ($26)", etc.
        indivPayment: 16,  // "Individual" col
        memberSince: 22,
    };

    // ── Deduplicate within the CSV by email ─────────────────────────────────────
    // Same email + same name → keep last occurrence (most recently submitted).
    // Same email + different name → keep first occurrence, log conflict for review.
    const byEmail = new Map(); // email → { row, rowNum, name }
    const conflicts = [];
    const dupSkips = [];

    dataRows.forEach((row, idx) => {
        const email = (row[C.email] || '').trim().toLowerCase();
        if (!email) return;

        const first = (row[C.firstName] || '').trim();
        const last = (row[C.lastName] || '').trim();
        const name = `${first} ${last}`.toLowerCase().trim();
        const csvRow = idx + 3; // 1-indexed, offset by 2 header rows

        if (byEmail.has(email)) {
            const prev = byEmail.get(email);
            if (prev.name !== name) {
                // Different people sharing an email — flag, keep first
                let conflict = conflicts.find(c => c.email === email);
                if (!conflict) {
                    conflict = {email, rows: [{csvRow: prev.csvRow, name: prev.name}]};
                    conflicts.push(conflict);
                }
                conflict.rows.push({csvRow, name});
            } else {
                // Same person re-submitted — keep this (later) row
                dupSkips.push({csvRow: prev.csvRow, name: `${first} ${last}`, email});
                byEmail.set(email, {row, rowNum: idx, csvRow, name});
            }
        } else {
            byEmail.set(email, {row, rowNum: idx, csvRow, name});
        }
    });

    if (dupSkips.length) {
        console.log('Duplicate submissions (same person, keeping latest):');
        dupSkips.forEach(d => console.log(`  Row ${d.csvRow}: ${d.name} <${d.email}>`));
        console.log();
    }

    if (conflicts.length) {
        console.log('⚠️  Email conflicts (different people, same email) — only first row imported:');
        conflicts.forEach(c => {
            console.log(`  ${c.email}:`);
            c.rows.forEach(r => console.log(`    Row ${r.csvRow}: ${r.name}`));
        });
        console.log();
    }

    // ── Import ──────────────────────────────────────────────────────────────────
    const stats = {imported: 0, skipped: 0, subMembers: 0, payments: 0, errors: []};

    for (const [email, {row, csvRow}] of byEmail) {
        const firstName = (row[C.firstName] || '').trim();
        const lastName = (row[C.lastName] || '').trim();

        if (!firstName || !lastName) {
            stats.errors.push(`Row ${csvRow}: missing name for <${email}>`);
            continue;
        }

        const membershipType = ((row[C.membershipType] || 'individual').trim().toLowerCase() === 'family')
            ? 'family' : 'individual';

        const payment = parsePayment(row[C.familyPayment], row[C.indivPayment]);
        const signupDate = parseDate(row[C.signupDate]);
        const memberSince = parseDate(row[C.memberSince]);
        const joinDate = memberSince || signupDate;

        // Idempotent sub-member insertion: only insert if (first_name, last_name, primary_member_id)
        // doesn't already exist. Returns count of newly inserted sub-members.
        async function upsertSubMembers(primaryId) {
            const subs = parseFamilyMembers(row[C.familyMembers], firstName, lastName);
            if (!subs.length) return 0;

            // Single query for all existing sub-members under this primary
            const existingRows = await db.all(
                'SELECT first_name, last_name FROM members WHERE primary_member_id = ?',
                primaryId
            );
            const existingNames = new Set(
                existingRows.map(r => `${r.first_name.toLowerCase()}|${r.last_name.toLowerCase()}`)
            );

            let added = 0;
            for (const sub of subs) {
                const key = `${sub.first_name.toLowerCase()}|${sub.last_name.toLowerCase()}`;
                if (existingNames.has(key)) continue;

                const subNumber = await generateMemberNumber(MEMBERSHIP_YEAR);
                const subResult = await db.run(
                    `INSERT INTO members
                     (member_number, first_name, last_name, email,
                      membership_year, membership_type, primary_member_id,
                      join_date, expiry_date, status)
                     VALUES (?, ?, ?, ?, ?, 'family', ?, COALESCE(?, datetime('now')), ?, 'active')`,
                    subNumber,
                    sub.first_name,
                    sub.last_name,
                    email,
                    MEMBERSHIP_YEAR,
                    primaryId,
                    joinDate ?? null,
                    EXPIRY_DATE
                );
                await auditLog.insert({
                    tableName: 'members',
                    recordId: subResult.lastInsertRowid,
                    action: 'INSERT',
                    actor: {id: null, email: 'csv-import'},
                    oldValues: null,
                    newValues: {
                        id: subResult.lastInsertRowid, member_number: subNumber,
                        first_name: sub.first_name, last_name: sub.last_name, email,
                        membership_year: MEMBERSHIP_YEAR, membership_type: 'family',
                        primary_member_id: primaryId, join_date: joinDate ?? null,
                        expiry_date: EXPIRY_DATE, status: 'active',
                    },
                });
                existingNames.add(key); // guard against duplicate names within the same CSV row
                added++;
            }
            return added;
        }

        // Check if primary already imported (idempotent re-runs)
        const already = await db.get(
            'SELECT id FROM members WHERE email = ? AND primary_member_id IS NULL',
            email
        );
        if (already) {
            // Primary exists — but sub-members may be missing if a previous run crashed
            // partway through. Reconcile them now.
            if (membershipType === 'family' && !DRY_RUN) {
                const added = await upsertSubMembers(already.id);
                if (added > 0) {
                    console.log(`  [SKIP+FIX] ${firstName} ${lastName} <${email}> — primary existed, added ${added} missing sub-member(s)`);
                    stats.subMembers += added;
                } else {
                    console.log(`  [SKIP] ${firstName} ${lastName} <${email}> — already in DB`);
                }
            } else {
                console.log(`  [SKIP] ${firstName} ${lastName} <${email}> — already in DB`);
            }
            stats.skipped++;
            continue;
        }

        const memberNumber = await generateMemberNumber(MEMBERSHIP_YEAR);

        if (DRY_RUN) {
            const payStr = payment
                ? `${payment.payment_method} $${(payment.amount_cents / 100).toFixed(2)}`
                : 'no payment';
            console.log(`  [DRY] ${memberNumber} ${firstName} ${lastName} <${email}> (${membershipType}, ${payStr})`);

            if (membershipType === 'family') {
                const subs = parseFamilyMembers(row[C.familyMembers], firstName, lastName);
                subs.forEach(s => console.log(`        + ${s.first_name} ${s.last_name}`));
            }
            stats.imported++;
            continue;
        }

        try {
            // Insert primary member with membership_type and expiry_date inline
            const result = await db.run(
                `INSERT INTO members
                 (member_number, first_name, last_name, email, phone,
                  address_street, address_city, address_state, address_zip,
                  membership_year, membership_type, join_date, expiry_date, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, 'active')`,
                memberNumber,
                firstName,
                lastName,
                email,
                (row[C.phone] || '').trim() || null,
                (row[C.address] || '').trim() || null,
                (row[C.city] || '').trim() || null,
                (row[C.state] || '').trim() || null,
                (row[C.zip] || '').trim() || null,
                MEMBERSHIP_YEAR,
                membershipType,
                joinDate ?? null,
                EXPIRY_DATE
            );
            const primaryId = result.lastInsertRowid;

            // Audit log for primary member — construct from known insert data, no extra SELECT
            await auditLog.insert({
                tableName: 'members',
                recordId: primaryId,
                action: 'INSERT',
                actor: {id: null, email: 'csv-import'},
                oldValues: null,
                newValues: {
                    id: primaryId, member_number: memberNumber,
                    first_name: firstName, last_name: lastName, email,
                    phone: (row[C.phone] || '').trim() || null,
                    address_street: (row[C.address] || '').trim() || null,
                    address_city: (row[C.city] || '').trim() || null,
                    address_state: (row[C.state] || '').trim() || null,
                    address_zip: (row[C.zip] || '').trim() || null,
                    membership_year: MEMBERSHIP_YEAR, membership_type: membershipType,
                    join_date: joinDate ?? null, expiry_date: EXPIRY_DATE, status: 'active',
                },
            });

            // Payment record
            if (payment && payment.amount_cents) {
                await paymentRepo.create({
                    member_id: primaryId,
                    amount_cents: payment.amount_cents,
                    status: 'completed',
                    payment_method: payment.payment_method,
                    description: `${MEMBERSHIP_YEAR}-${MEMBERSHIP_YEAR + 1} membership`,
                });
                stats.payments++;
            }

            // Family sub-members (idempotent — upsertSubMembers checks before each insert)
            if (membershipType === 'family') {
                stats.subMembers += await upsertSubMembers(primaryId);
            }

            console.log(`  [OK] ${memberNumber} ${firstName} ${lastName} <${email}> (${membershipType})`);
            stats.imported++;
        } catch (e) {
            stats.errors.push(`Row ${csvRow}: ${firstName} ${lastName} <${email}> — ${e.message}`);
            console.error(`  [ERR] Row ${csvRow}: ${e.message}`);
        }
    }

    // ── Summary ─────────────────────────────────────────────────────────────────
    console.log('\n─── Summary ───────────────────────────────────────────────────────────────');
    if (DRY_RUN) console.log('DRY RUN — nothing written');
    console.log(`Primary members imported : ${stats.imported}`);
    console.log(`Family sub-members       : ${stats.subMembers}`);
    console.log(`Payment records          : ${stats.payments}`);
    console.log(`Skipped (already in DB)  : ${stats.skipped}`);
    if (stats.errors.length) {
        console.log(`\nErrors (${stats.errors.length}):`);
        stats.errors.forEach(e => console.log(`  ${e}`));
    }

    await db.close();
}

main().catch(e => {
    console.error('Fatal:', e.message);
    process.exit(1);
});
