jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const { insertMember, insertPayment } = require('../helpers/fixtures');

// We test the CSV export by calling the route handler directly
// to avoid needing to spin up the full Express app with sessions/auth.
const { toCsv } = require('../../services/csv');

beforeEach(() => {
  db.__resetTestDb();
});

describe('GET /members/export (CSV pipeline)', () => {
  test('produces CSV with correct headers for members', () => {
    const testDb = db.__getCurrentDb();
    insertMember(testDb, { email: 'a@test.com', first_name: 'Alice', last_name: 'Smith', member_number: 'YSH-2025-0001' });
    insertMember(testDb, { email: 'b@test.com', first_name: 'Bob', last_name: 'Jones', member_number: 'YSH-2025-0002' });

    const members = testDb.prepare('SELECT * FROM members ORDER BY created_at DESC').all();
    const columns = ['member_number', 'first_name', 'last_name', 'email', 'phone', 'address_street', 'address_city', 'address_state', 'address_zip', 'membership_year', 'status', 'notes', 'created_at'];
    const headers = ['Member Number', 'First Name', 'Last Name', 'Email', 'Phone', 'Street', 'City', 'State', 'Zip', 'Year', 'Status', 'Notes', 'Created'];
    const csv = toCsv(members, columns, headers);

    const lines = csv.split('\n');
    expect(lines[0]).toBe('Member Number,First Name,Last Name,Email,Phone,Street,City,State,Zip,Year,Status,Notes,Created');
    expect(lines.length).toBe(3); // header + 2 data rows
    expect(csv).toContain('Alice');
    expect(csv).toContain('Bob');
  });

  test('produces empty CSV with only headers when no members', () => {
    const testDb = db.__getCurrentDb();
    const members = testDb.prepare('SELECT * FROM members').all();
    const columns = ['member_number', 'first_name', 'last_name', 'email'];
    const headers = ['Member Number', 'First Name', 'Last Name', 'Email'];
    const csv = toCsv(members, columns, headers);
    const lines = csv.split('\n');
    expect(lines.length).toBe(1);
    expect(lines[0]).toBe('Member Number,First Name,Last Name,Email');
  });
});

describe('GET /payments/export (CSV pipeline)', () => {
  test('produces CSV with payment data joined with member info', () => {
    const testDb = db.__getCurrentDb();
    const member = insertMember(testDb, { email: 'payer@test.com', first_name: 'Charlie', member_number: 'YSH-2025-0001' });
    insertPayment(testDb, { member_id: member.id, amount_cents: 5000, payment_method: 'cash' });

    const payments = testDb.prepare(
      `SELECT p.*, m.first_name, m.last_name, m.member_number
       FROM payments p LEFT JOIN members m ON p.member_id = m.id
       ORDER BY p.created_at DESC`
    ).all();
    const columns = ['member_number', 'first_name', 'last_name', 'amount_cents', 'currency', 'status', 'payment_method', 'description', 'created_at'];
    const headers = ['Member Number', 'First Name', 'Last Name', 'Amount (cents)', 'Currency', 'Status', 'Payment Method', 'Description', 'Date'];
    const csv = toCsv(payments, columns, headers);

    expect(csv).toContain('Charlie');
    expect(csv).toContain('5000');
    expect(csv).toContain('cash');
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Member Number,First Name,Last Name,Amount (cents),Currency,Status,Payment Method,Description,Date');
  });
});
