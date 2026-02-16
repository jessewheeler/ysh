jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const { insertMember, insertSetting, insertCard } = require('../helpers/fixtures');

let emailService;
let testMember;

beforeEach(() => {
  db.__resetTestDb();
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 202 });

  // Re-require to get fresh module with mocked deps
  jest.isolateModules(() => {
    emailService = require('../../services/email');
  });

  const testDb = db.__getCurrentDb();
  testMember = insertMember(testDb, {
    email: 'member@test.com',
    first_name: 'John',
    last_name: 'Doe',
    member_number: 'YSH-2025-0001',
    membership_year: 2025,
    status: 'active',
  });
});

function getFetchBody(callIndex = 0) {
  const callArgs = global.fetch.mock.calls[callIndex];
  if (!callArgs) return null;
  return JSON.parse(callArgs[1].body);
}

describe('sendWelcomeEmail', () => {
  test('sends to correct recipient with correct subject', async () => {
    await emailService.sendWelcomeEmail(testMember);
    const body = getFetchBody();
    expect(body.to[0].email).toBe('member@test.com');
    expect(body.subject).toBe('Welcome to the Yellowstone Sea Hawkers!');
  });

  test('includes member info in body', async () => {
    await emailService.sendWelcomeEmail(testMember);
    const body = getFetchBody();
    expect(body.html).toContain('YSH-2025-0001');
    expect(body.html).toContain('John');
  });

  test('logs with type welcome', async () => {
    await emailService.sendWelcomeEmail(testMember);
    const log = await db.get("SELECT * FROM emails_log WHERE email_type = 'welcome'");
    expect(log).toBeDefined();
    expect(log.to_email).toBe('member@test.com');
    expect(log.status).toBe('sent');
  });

  test('re-throws on MailerSend failure', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ message: 'MailerSend error' }),
    });
    await expect(emailService.sendWelcomeEmail(testMember)).rejects.toThrow('MailerSend error');
  });

  test('logs failure when MailerSend errors', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ message: 'MailerSend error' }),
    });
    await emailService.sendWelcomeEmail(testMember).catch(() => {});
    const log = await db.get("SELECT * FROM emails_log WHERE status = 'failed'");
    expect(log).toBeDefined();
    expect(log.error).toContain('MailerSend error');
  });
});

describe('sendPaymentConfirmation', () => {
  test('formats cents to dollars in email body', async () => {
    await emailService.sendPaymentConfirmation(testMember, { amount_total: 2500 });
    const body = getFetchBody();
    expect(body.html).toContain('$25.00');
  });

  test('handles missing amount_total', async () => {
    await emailService.sendPaymentConfirmation(testMember, {});
    const body = getFetchBody();
    expect(body.html).toContain('N/A');
  });

  test('logs with type payment_confirmation', async () => {
    await emailService.sendPaymentConfirmation(testMember, { amount_total: 2500 });
    const log = await db.get("SELECT * FROM emails_log WHERE email_type = 'payment_confirmation'");
    expect(log).toBeDefined();
    expect(log.status).toBe('sent');
  });
});

describe('sendCardEmail', () => {
  test('throws when no card exists for member', async () => {
    await expect(emailService.sendCardEmail(testMember)).rejects.toThrow('No card found');
  });

  test('sends email when card exists with pdf and png', async () => {
    const testDb = db.__getCurrentDb();
    insertCard(testDb, {
      member_id: testMember.id,
      pdf_path: 'data/cards/card-1-2025.pdf',
      png_path: 'data/cards/card-1-2025.png',
      year: 2025,
    });

    // fs.existsSync will return false for these paths, so no attachments but email still sends
    await emailService.sendCardEmail(testMember);
    expect(global.fetch).toHaveBeenCalled();
  });

  test('logs with type card_delivery', async () => {
    const testDb = db.__getCurrentDb();
    insertCard(testDb, {
      member_id: testMember.id,
      pdf_path: 'data/cards/card-1-2025.pdf',
      png_path: 'data/cards/card-1-2025.png',
      year: 2025,
    });

    await emailService.sendCardEmail(testMember);
    const log = await db.get("SELECT * FROM emails_log WHERE email_type = 'card_delivery'");
    expect(log).toBeDefined();
  });
});

describe('sendBlastEmail', () => {
  test('passes subject and body through', async () => {
    await emailService.sendBlastEmail(testMember, 'Big News', '<p>Hello all!</p>');
    const body = getFetchBody();
    expect(body.subject).toBe('Big News');
    expect(body.html).toContain('Hello all!');
  });

  test('logs with type blast', async () => {
    await emailService.sendBlastEmail(testMember, 'Subj', '<p>Body</p>');
    const log = await db.get("SELECT * FROM emails_log WHERE email_type = 'blast'");
    expect(log).toBeDefined();
    expect(log.to_email).toBe('member@test.com');
  });
});

describe('sendOtpEmail', () => {
  test('sends to correct recipient with OTP code in body', async () => {
    await emailService.sendOtpEmail({ to: 'admin@test.com', toName: 'Admin User', otp: '123456' });
    const body = getFetchBody();
    expect(body.to[0].email).toBe('admin@test.com');
    expect(body.html).toContain('123456');
    expect(body.subject).toContain('Login Code');
  });

  test('logs with type otp', async () => {
    await emailService.sendOtpEmail({ to: 'admin@test.com', toName: 'Admin User', otp: '654321' });
    const log = await db.get("SELECT * FROM emails_log WHERE email_type = 'otp'");
    expect(log).toBeDefined();
    expect(log.to_email).toBe('admin@test.com');
    expect(log.status).toBe('sent');
  });

  test('does not include member_id', async () => {
    await emailService.sendOtpEmail({ to: 'admin@test.com', toName: 'Admin User', otp: '111111' });
    const log = await db.get("SELECT * FROM emails_log WHERE email_type = 'otp'");
    expect(log.member_id).toBeNull();
  });

  test('re-throws on MailerSend failure', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ message: 'MailerSend error' }),
    });
    await expect(emailService.sendOtpEmail({ to: 'a@b.com', toName: 'X', otp: '000000' })).rejects.toThrow('MailerSend error');
  });
});

describe('sendContactEmail', () => {
  test('sends to contact_email from settings', async () => {
    // Reset DB for this specific test
    db.__resetTestDb();
    const testDb = db.__getCurrentDb();
    insertSetting(testDb, 'contact_email', 'admin@ysh.org');

    await emailService.sendContactEmail({ name: 'Bob', email: 'bob@test.com', message: 'Hi there' });
    const calls = global.fetch.mock.calls;
    const body = JSON.parse(calls[calls.length - 1][1].body);
    expect(body.to[0].email).toBe('admin@ysh.org');
  });

  test('falls back to FROM_EMAIL when no setting', async () => {
    // Force a fresh DB state for this test
    db.__resetTestDb();
    await emailService.sendContactEmail({ name: 'Bob', email: 'bob@test.com', message: 'Hello' });
    const calls = global.fetch.mock.calls;
    const body = JSON.parse(calls[calls.length - 1][1].body);
    expect(body.to[0].email).toBeTruthy();
  });

  test('converts newlines in message to <br>', async () => {
    await emailService.sendContactEmail({ name: 'Bob', email: 'bob@test.com', message: 'Line1\nLine2' });
    const body = getFetchBody();
    expect(body.html).toContain('Line1<br>Line2');
  });

  test('logs with type contact', async () => {
    await emailService.sendContactEmail({ name: 'Bob', email: 'bob@test.com', message: 'Test' });
    const log = await db.get("SELECT * FROM emails_log WHERE email_type = 'contact'");
    expect(log).toBeDefined();
  });

  test('includes sender name in subject', async () => {
    await emailService.sendContactEmail({ name: 'Alice', email: 'alice@test.com', message: 'Msg' });
    const calls = global.fetch.mock.calls;
    const body = JSON.parse(calls[calls.length - 1][1].body);
    expect(body.subject).toContain('Alice');
  });
});
