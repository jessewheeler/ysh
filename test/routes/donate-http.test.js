/**
 * HTTP integration tests for donations (issue #126): the real Express app, session, CSRF,
 * Pug rendering, repos and email service. Only the database (in-memory SQLite), the Stripe
 * SDK and the outbound MailerSend request are swapped.
 */
process.env.NODE_ENV = 'test';

jest.mock('../../db/database', () => require('../helpers/setupDb'));

const mockSessionCreate = jest.fn();
const mockConstructEvent = jest.fn();
jest.mock('stripe', () => () => ({
  checkout: { sessions: { create: (...args) => mockSessionCreate(...args) } },
  webhooks: { constructEvent: (...args) => mockConstructEvent(...args) },
}));

const request = require('supertest');
const app = require('../../server');
const db = require('../../db/database');
const { insertMember, insertAdmin, insertDonation, insertDonationFund } = require('../helpers/fixtures');

const TEST_OTP = '000000';

function tokenFrom(html) {
  // Public forms carry a hidden input; admin pages carry a meta tag that admin.js copies
  // into each form.
  const match = html.match(/name="_csrf" value="([^"]+)"/)
    || html.match(/name="csrf-token" content="([^"]+)"/);
  if (!match) throw new Error('No CSRF token in response');
  return match[1];
}

async function loginAsAdmin(email) {
  const agent = request.agent(app);
  const loginPage = await agent.get('/admin/login').expect(200);
  await agent.post('/admin/login').type('form')
    .send({ _csrf: tokenFrom(loginPage.text), email }).expect(302);
  const verifyPage = await agent.get('/admin/login/verify').expect(200);
  await agent.post('/admin/login/verify').type('form')
    .send({ _csrf: tokenFrom(verifyPage.text), code: TEST_OTP })
    .expect(302).expect('location', '/admin/dashboard');
  return agent;
}

/** Submits the donate form the way a browser would and returns the response. */
async function donate(fields) {
  const agent = request.agent(app);
  const page = await agent.get('/donate').expect(200);
  const res = await agent.post('/donate').type('form').send({ _csrf: tokenFrom(page.text), ...fields });
  return { agent, res };
}

/** Delivers a Stripe event to the webhook. The signature check is the mocked SDK call. */
async function deliver(event) {
  mockConstructEvent.mockReturnValueOnce(event);
  return request(app).post('/stripe/webhook')
    .set('stripe-signature', 'sig')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(event))
    .expect(200);
}

function rows(sql, ...params) {
  return db.__getCurrentDb().prepare(sql).all(...params);
}

let general;
let wheels;
let birds;

beforeEach(() => {
  db.__resetTestDb();
  jest.clearAllMocks();
  mockSessionCreate.mockImplementation(async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.test/pay/cs_test_1' }));
  // MailerSend: accept every send. The email service still writes emails_log for real.
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  general = insertDonationFund(db, { name: 'General Fund', sort_order: 1 });
  wheels = insertDonationFund(db, { name: 'Heart Wheels', sort_order: 2 });
  birds = insertDonationFund(db, { name: 'Battle of the Birds', sort_order: 3 });
});

describe('GET /donate', () => {
  test('offers the active funds, the presets with $12 selected, and both opt-ins unticked', async () => {
    insertDonationFund(db, { name: 'Retired Drive', sort_order: 4, is_active: 0 });

    const res = await request(app).get('/donate').expect(200);

    expect(res.text).toContain('>General Fund</option>');
    expect(res.text).toContain('>Heart Wheels</option>');
    expect(res.text).not.toContain('Retired Drive');
    expect(res.text).toMatch(/name="amount_preset" value="1200" checked/);
    expect(res.text).not.toMatch(/name="amount_preset" value="2500" checked/);
    expect(res.text).not.toMatch(/name="cover_fee"[^>]*checked/);
    expect(res.text).not.toMatch(/name="anonymous"[^>]*checked/);
    expect(res.text).toContain('$0.67');
  });

  test('preselects a fund named in the query string, by slug or id', async () => {
    const bySlug = await request(app).get('/donate?fund=battle-of-the-birds').expect(200);
    expect(bySlug.text).toMatch(new RegExp(`<option value="${birds.id}" selected`));

    const byId = await request(app).get(`/donate?fund=${wheels.id}`).expect(200);
    expect(byId.text).toMatch(new RegExp(`<option value="${wheels.id}" selected`));

    const unknown = await request(app).get('/donate?fund=nope').expect(200);
    expect(unknown.text).toMatch(new RegExp(`<option value="${general.id}" selected`));
  });

  test('says donations are closed when no fund is active', async () => {
    db.__getCurrentDb().prepare('UPDATE donation_funds SET is_active = 0').run();

    const res = await request(app).get('/donate').expect(200);

    expect(res.text).toContain("Online donations aren't open right now");
    expect(res.text).not.toContain('id="donate-form"');
  });

  test('the nav links to the donate page', async () => {
    const res = await request(app).get('/donate').expect(200);
    expect(res.text).toMatch(/<a class="btn-donate" href="\/donate">Donate<\/a>/);
  });
});

describe('POST /donate: named gift', () => {
  test('records a pending donation and sends the donor to Stripe', async () => {
    const { res } = await donate({
      donor_name: 'Jane Donor', donor_email: 'Jane@Example.com', fund_id: wheels.id, amount_preset: '1200',
    });

    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('https://checkout.stripe.test/pay/cs_test_1');

    const [row] = rows('SELECT * FROM donations');
    expect(row).toMatchObject({
      donor_name: 'Jane Donor',
      donor_email: 'jane@example.com',
      is_anonymous: 0,
      fund_id: wheels.id,
      gift_cents: 1200,
      fee_cover_cents: 0,
      amount_cents: 1200,
      status: 'pending',
      stripe_session_id: 'cs_test_1',
      member_id: null,
    });

    const params = mockSessionCreate.mock.calls[0][0];
    expect(params.customer_email).toBe('jane@example.com');
    expect(params.metadata).toEqual({ donation: 'true', donation_id: String(row.id) });
    expect(params.payment_intent_data.metadata).toEqual(params.metadata);
    expect(params.line_items).toHaveLength(1);
    expect(params.line_items[0].price_data.unit_amount).toBe(1200);
    expect(params.line_items[0].price_data.product_data.name).toBe('Donation — Heart Wheels');
  });

  test('adds the fee as a second line item only when the donor opts in', async () => {
    await donate({
      donor_name: 'Jane Donor', donor_email: 'jane@example.com', fund_id: general.id,
      amount_preset: '2500', cover_fee: '1',
    });

    const [row] = rows('SELECT * FROM donations');
    expect(row).toMatchObject({ gift_cents: 2500, fee_cover_cents: 106, amount_cents: 2606 });

    const items = mockSessionCreate.mock.calls[0][0].line_items;
    expect(items.map(i => i.price_data.unit_amount)).toEqual([2500, 106]);
    expect(items[1].price_data.product_data.name).toBe('Card processing fee');
  });

  test('takes an Other amount', async () => {
    await donate({
      donor_name: 'Jane Donor', donor_email: 'jane@example.com', fund_id: general.id,
      amount_preset: 'custom', amount_custom: '15.50',
    });

    expect(rows('SELECT gift_cents FROM donations')[0].gift_cents).toBe(1550);
  });

  test('ties the gift to a member whose email matches, whatever the case', async () => {
    const member = insertMember(db, { email: 'Member@Example.com' });

    await donate({
      donor_name: 'Mel Member', donor_email: 'MEMBER@example.com', fund_id: general.id, amount_preset: '1200',
    });

    expect(rows('SELECT member_id FROM donations')[0].member_id).toBe(member.id);
  });

  test('a validation error flashes on the form and nothing is recorded or sent to Stripe', async () => {
    const { agent, res } = await donate({
      donor_name: '', donor_email: '', fund_id: general.id, amount_preset: '1200',
    });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/donate');
    const page = await agent.get('/donate');
    expect(page.text).toContain('Name and email are required');
    expect(rows('SELECT * FROM donations')).toHaveLength(0);
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  test('refuses a retired fund', async () => {
    const retired = insertDonationFund(db, { name: 'Retired Drive', is_active: 0 });

    const { res } = await donate({
      donor_name: 'Jane', donor_email: 'jane@example.com', fund_id: retired.id, amount_preset: '1200',
    });

    expect(res.headers.location).toBe('/donate');
    expect(rows('SELECT * FROM donations')).toHaveLength(0);
  });

  test('a Stripe failure flashes a generic error and leaves the pending row for the record', async () => {
    mockSessionCreate.mockRejectedValueOnce(new Error('stripe down'));

    const { agent, res } = await donate({
      donor_name: 'Jane', donor_email: 'jane@example.com', fund_id: general.id, amount_preset: '1200',
    });

    expect(res.headers.location).toBe('/donate');
    expect((await agent.get('/donate')).text).toContain('Something went wrong');
    expect(rows('SELECT status, stripe_session_id FROM donations')).toEqual([
      { status: 'pending', stripe_session_id: null },
    ]);
  });

  test('is refused without a CSRF token', async () => {
    await request(app).post('/donate').type('form')
      .send({ donor_name: 'Jane', donor_email: 'jane@example.com', fund_id: general.id, amount_preset: '1200' })
      .expect(302);
    expect(rows('SELECT * FROM donations')).toHaveLength(0);
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });
});

describe('POST /donate: anonymous gift', () => {
  test('stores no name or email and tells Stripe nothing about the donor', async () => {
    const { res } = await donate({
      anonymous: '1', fund_id: birds.id, amount_preset: '5000',
      // A browser with the script blocked would still send these.
      donor_name: 'Should Not Be Stored', donor_email: 'secret@example.com',
    });

    expect(res.status).toBe(303);
    const [row] = rows('SELECT * FROM donations');
    expect(row).toMatchObject({
      is_anonymous: 1, donor_name: null, donor_email: null, member_id: null,
      fund_id: birds.id, gift_cents: 5000, status: 'pending',
    });

    const params = mockSessionCreate.mock.calls[0][0];
    expect(params).not.toHaveProperty('customer_email');
    expect(params.metadata).toEqual({ donation: 'true', donation_id: String(row.id) });
    expect(JSON.stringify(params)).not.toContain('secret@example.com');
    expect(JSON.stringify(params)).not.toContain('Should Not Be Stored');

    const audit = rows("SELECT new_values FROM audit_log WHERE table_name = 'donations'");
    expect(JSON.stringify(audit)).not.toContain('secret@example.com');
  });

  test('is not linked to a member even when the submitted email is one', async () => {
    insertMember(db, { email: 'secret@example.com' });

    await donate({ anonymous: '1', fund_id: general.id, amount_preset: '1200', donor_email: 'secret@example.com' });

    expect(rows('SELECT member_id FROM donations')[0].member_id).toBeNull();
  });
});

describe('Stripe webhook: donations', () => {
  function completedEvent(donation, extra = {}) {
    return {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: donation.stripe_session_id || 'cs_hook',
          payment_intent: 'pi_hook',
          amount_total: donation.amount_cents,
          metadata: { donation: 'true', donation_id: String(donation.id) },
          ...extra,
        },
      },
    };
  }

  test('completes a named gift, links the member and sends one thank-you', async () => {
    const member = insertMember(db, { email: 'mel@example.com' });
    const donation = insertDonation(db, {
      donor_name: 'Mel Member', donor_email: 'mel@example.com', fund_id: wheels.id,
      gift_cents: 2500, fee_cover_cents: 106, status: 'pending', stripe_session_id: 'cs_named',
    });

    await deliver(completedEvent(donation));

    const [row] = rows('SELECT * FROM donations');
    expect(row).toMatchObject({ status: 'completed', stripe_payment_intent: 'pi_hook', member_id: member.id });

    const emails = rows('SELECT * FROM emails_log');
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({
      to_email: 'mel@example.com', email_type: 'donation_confirmation', status: 'sent', member_id: member.id,
    });
    expect(emails[0].body_html).toContain('Heart Wheels');
    expect(emails[0].body_html).toContain('$25.00');
    expect(emails[0].body_html).toContain('$1.06');
    expect(emails[0].body_html).toContain('$26.06');
  });

  test('a redelivered event does not send a second thank-you', async () => {
    const donation = insertDonation(db, { status: 'pending', stripe_session_id: 'cs_twice' });

    await deliver(completedEvent(donation));
    await deliver(completedEvent(donation));

    expect(rows('SELECT * FROM emails_log')).toHaveLength(1);
  });

  test('completes an anonymous gift without storing or mailing what Stripe collected', async () => {
    insertMember(db, { email: 'secret@example.com' });
    const donation = insertDonation(db, {
      is_anonymous: true, fund_id: general.id, gift_cents: 5000, status: 'pending', stripe_session_id: 'cs_anon',
    });

    await deliver(completedEvent(donation, {
      customer_email: 'secret@example.com',
      customer_details: { email: 'secret@example.com', name: 'Secret Giver' },
    }));

    const [row] = rows('SELECT * FROM donations');
    expect(row).toMatchObject({
      status: 'completed', is_anonymous: 1, donor_name: null, donor_email: null, member_id: null,
    });
    expect(rows('SELECT * FROM emails_log')).toHaveLength(0);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(rows('SELECT * FROM audit_log'))).not.toContain('secret@example.com');
    expect(JSON.stringify(rows('SELECT * FROM audit_log'))).not.toContain('Secret Giver');
  });

  test('finds the donation by its id when the session id was never attached', async () => {
    const donation = insertDonation(db, { status: 'pending', stripe_session_id: null });

    await deliver(completedEvent(donation));

    expect(rows('SELECT status, stripe_session_id FROM donations')).toEqual([
      { status: 'completed', stripe_session_id: 'cs_hook' },
    ]);
  });

  test('an email failure still answers 200 and leaves the donation completed', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ message: 'boom' }) });
    const donation = insertDonation(db, { status: 'pending', stripe_session_id: 'cs_mailfail' });

    await deliver(completedEvent(donation));

    expect(rows('SELECT status FROM donations')[0].status).toBe('completed');
  });

  test('an expired checkout marks the donation failed', async () => {
    insertDonation(db, { status: 'pending', stripe_session_id: 'cs_expired' });

    await deliver({
      type: 'checkout.session.expired',
      data: { object: { id: 'cs_expired', metadata: { donation: 'true', donation_id: '1' } } },
    });

    expect(rows('SELECT status FROM donations')[0].status).toBe('failed');
  });

  test('a declined card on a donation is ignored and writes no payment row', async () => {
    insertDonation(db, { status: 'pending', stripe_session_id: 'cs_declined' });

    await deliver({
      type: 'payment_intent.payment_failed',
      data: { object: { id: 'pi_declined', amount: 1200, metadata: { donation: 'true', donation_id: '1' } } },
    });

    expect(rows('SELECT status FROM donations')[0].status).toBe('pending');
    expect(rows('SELECT * FROM payments')).toHaveLength(0);
  });
});

describe('admin: donations', () => {
  test('redirects an anonymous visitor to the login page', async () => {
    await request(app).get('/admin/donations').expect(302).expect('location', '/admin/login');
    await request(app).get('/admin/donations/funds').expect(302).expect('location', '/admin/login');
  });

  test('lists donations with totals by fund and shows an anonymous donor as Anonymous', async () => {
    insertAdmin(db, { email: 'admin@ysh.test', role: 'editor' });
    const member = insertMember(db, { email: 'mel@example.com', first_name: 'Mel', last_name: 'Member' });
    insertDonation(db, {
      donor_name: 'Mel Member', donor_email: 'mel@example.com', member_id: member.id,
      fund_id: wheels.id, gift_cents: 1200, fee_cover_cents: 67,
    });
    insertDonation(db, { is_anonymous: true, fund_id: wheels.id, gift_cents: 2500 });
    insertDonation(db, { donor_name: 'Pending Pat', fund_id: general.id, gift_cents: 9900, status: 'pending' });

    const agent = await loginAsAdmin('admin@ysh.test');
    const res = await agent.get('/admin/donations').expect(200);

    expect(res.text).toMatch(/id="donations-count">2</);
    expect(res.text).toMatch(/id="donations-gifts">\$37</);
    expect(res.text).toMatch(/id="donations-fee-cover">\$0\.67</);
    // Estimated fees: 1267 -> 67, 2500 -> 103; donors covered 67, so 103 absorbed.
    expect(res.text).toMatch(/id="donations-fee-absorbed">\$1\.03</);
    expect(res.text).toContain('<em>Anonymous</em>');
    expect(res.text).toContain(`<a href="/admin/members/${member.id}">Mel Member</a>`);
    expect(res.text).toContain('Pending Pat');
    // An editor does not get the fund management link.
    expect(res.text).not.toContain('Manage Funds');
  });

  test('the dashboard shows a donations card once a donation has completed', async () => {
    insertAdmin(db, { email: 'admin@ysh.test' });
    const agent = await loginAsAdmin('admin@ysh.test');

    expect((await agent.get('/admin/dashboard').expect(200)).text).not.toContain('href="/admin/donations"><div class="stat-number"');

    insertDonation(db, { gift_cents: 1200, fee_cover_cents: 67 });
    const res = await agent.get('/admin/dashboard').expect(200);
    expect(res.text).toContain('Donations (1)');
    expect(res.text).toMatch(/class="stat-card" href="\/admin\/donations"><div class="stat-number">\$12</);
  });
});

describe('admin: donation history on the member page', () => {
  test('shows the member\'s gifts with a lifetime total of completed ones', async () => {
    insertAdmin(db, { email: 'admin@ysh.test' });
    const member = insertMember(db, { email: 'mel@example.com' });
    const other = insertMember(db, { email: 'other@example.com' });
    insertDonation(db, { member_id: member.id, fund_id: wheels.id, gift_cents: 1200, fee_cover_cents: 67 });
    insertDonation(db, { member_id: member.id, fund_id: birds.id, gift_cents: 5000 });
    insertDonation(db, { member_id: member.id, fund_id: general.id, gift_cents: 7700, status: 'pending' });
    insertDonation(db, { member_id: other.id, fund_id: general.id, gift_cents: 9900 });

    const agent = await loginAsAdmin('admin@ysh.test');
    const res = await agent.get(`/admin/members/${member.id}`).expect(200);

    expect(res.text).toContain('Donation History');
    const table = res.text.slice(res.text.indexOf('id="member-donations"'));
    const history = table.slice(0, table.indexOf('</table>'));
    expect(history).toContain('Heart Wheels');
    expect(history).toContain('Battle of the Birds');
    expect(history).toContain('$12.67');
    expect(history).toContain('$77.00');
    expect(history).not.toContain('$99.00');
    expect(res.text).toMatch(/id="member-donations-total">\$62\.00</);
  });

  test('says so when the member has no donations', async () => {
    insertAdmin(db, { email: 'admin@ysh.test' });
    const member = insertMember(db, { email: 'mel@example.com' });

    const agent = await loginAsAdmin('admin@ysh.test');
    const res = await agent.get(`/admin/members/${member.id}`).expect(200);

    expect(res.text).toContain('No donations linked to this member.');
  });
});

describe('admin: donation funds', () => {
  test('an editor cannot open or change funds', async () => {
    insertAdmin(db, { email: 'editor@ysh.test', role: 'editor' });
    const agent = await loginAsAdmin('editor@ysh.test');

    const page = await agent.get('/admin/donations/funds');
    expect(page.status).not.toBe(200);

    const dashboard = await agent.get('/admin/dashboard');
    await agent.post('/admin/donations/funds').type('form')
      .send({ _csrf: tokenFrom(dashboard.text), name: 'Sneaky Fund' });
    expect(rows("SELECT * FROM donation_funds WHERE name = 'Sneaky Fund'")).toHaveLength(0);
  });

  test('a super admin adds, renames, retires and restores a fund', async () => {
    insertAdmin(db, { email: 'super@ysh.test', role: 'super_admin' });
    const agent = await loginAsAdmin('super@ysh.test');
    const csrf = async () => tokenFrom((await agent.get('/admin/donations/funds').expect(200)).text);

    await agent.post('/admin/donations/funds').type('form')
      .send({ _csrf: await csrf(), name: 'Turkey Drive', sort_order: '9' })
      .expect(302).expect('location', '/admin/donations/funds');
    const [fund] = rows("SELECT * FROM donation_funds WHERE name = 'Turkey Drive'");
    expect(fund).toMatchObject({ sort_order: 9, is_active: 1 });
    expect((await request(app).get('/donate')).text).toContain('>Turkey Drive</option>');

    await agent.post(`/admin/donations/funds/${fund.id}`).type('form')
      .send({ _csrf: await csrf(), name: 'Turkey Drive 2026', sort_order: '2' }).expect(302);
    expect(rows('SELECT name, sort_order FROM donation_funds WHERE id = ?', fund.id)).toEqual([
      { name: 'Turkey Drive 2026', sort_order: 2 },
    ]);

    await agent.post(`/admin/donations/funds/${fund.id}/active`).type('form')
      .send({ _csrf: await csrf(), is_active: '0' }).expect(302);
    expect(rows('SELECT is_active FROM donation_funds WHERE id = ?', fund.id)[0].is_active).toBe(0);
    expect((await request(app).get('/donate')).text).not.toContain('Turkey Drive 2026');

    await agent.post(`/admin/donations/funds/${fund.id}/active`).type('form')
      .send({ _csrf: await csrf(), is_active: '1' }).expect(302);
    expect((await request(app).get('/donate')).text).toContain('>Turkey Drive 2026</option>');
  });

  test('a blank name is refused with a message', async () => {
    insertAdmin(db, { email: 'super@ysh.test', role: 'super_admin' });
    const agent = await loginAsAdmin('super@ysh.test');
    const page = await agent.get('/admin/donations/funds').expect(200);

    await agent.post('/admin/donations/funds').type('form')
      .send({ _csrf: tokenFrom(page.text), name: '   ' }).expect(302);

    expect((await agent.get('/admin/donations/funds')).text).toContain('Fund name is required.');
    expect(rows('SELECT * FROM donation_funds')).toHaveLength(3);
  });

  test('a retired fund keeps its donations in the totals', async () => {
    insertAdmin(db, { email: 'super@ysh.test', role: 'super_admin' });
    insertDonation(db, { fund_id: wheels.id, gift_cents: 1200 });
    db.__getCurrentDb().prepare('UPDATE donation_funds SET is_active = 0 WHERE id = ?').run(wheels.id);

    const agent = await loginAsAdmin('super@ysh.test');
    const res = await agent.get('/admin/donations').expect(200);

    const byFund = res.text.slice(res.text.indexOf('id="donations-by-fund"'));
    expect(byFund.slice(0, byFund.indexOf('</table>'))).toMatch(/Heart Wheels[\s\S]*retired[\s\S]*\$12\.00/);
    expect(res.text).toContain('Manage Funds');
  });
});
