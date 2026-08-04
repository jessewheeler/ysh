jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const { insertMember } = require('../helpers/fixtures');

let senderService;
let testDb;

const CURRENT_GROUP = 'grpCUR';
const LAPSED_GROUP = 'grpLAP';

// Sender responses carry rate-limit headers the service inspects.
function response({ ok = true, status = 200, body = { success: true }, headers = {} } = {}) {
  const map = { 'X-RateLimit-Remaining': '50', ...headers };
  return {
    ok,
    status,
    headers: { get: (k) => (k in map ? map[k] : null) },
    json: async () => body,
  };
}

beforeEach(() => {
  db.__resetTestDb();
  jest.clearAllMocks();

  process.env.SENDER_API_TOKEN = 'test-token';
  process.env.SENDER_GROUP_CURRENT = CURRENT_GROUP;
  process.env.SENDER_GROUP_LAPSED = LAPSED_GROUP;

  global.fetch = jest.fn().mockResolvedValue(response());

  jest.isolateModules(() => {
    senderService = require('../../services/sender');
  });

  testDb = db.__getCurrentDb();
});

afterEach(() => {
  delete process.env.SENDER_API_TOKEN;
  delete process.env.SENDER_GROUP_CURRENT;
  delete process.env.SENDER_GROUP_LAPSED;
});

function calls() {
  return global.fetch.mock.calls.map(([url, opts]) => ({
    url,
    method: opts.method,
    body: opts.body ? JSON.parse(opts.body) : undefined,
    auth: opts.headers.Authorization,
  }));
}

describe('isConfigured', () => {
  test('is false when the token is missing', () => {
    delete process.env.SENDER_API_TOKEN;
    expect(senderService.isConfigured()).toBe(false);
  });

  test('is false when a group id is missing', () => {
    delete process.env.SENDER_GROUP_LAPSED;
    expect(senderService.isConfigured()).toBe(false);
  });

  test('is true when all vars are set', () => {
    expect(senderService.isConfigured()).toBe(true);
  });
});

describe('groupForMember', () => {
  test('active members go to the current group', () => {
    expect(senderService.groupForMember({ status: 'active' })).toBe(CURRENT_GROUP);
  });

  test('lifetime members are active regardless of status', () => {
    expect(senderService.groupForMember({ status: 'expired', is_lifetime: 1 })).toBe(CURRENT_GROUP);
  });

  test('expired members go to the lapsed group', () => {
    expect(senderService.groupForMember({ status: 'expired' })).toBe(LAPSED_GROUP);
  });

  // Nothing in the app writes status='expired'; a membership that runs out keeps
  // status='active' with a past expiry_date, so Lapsed has to be derived from the date.
  test('an active member whose expiry date has passed is lapsed', () => {
    expect(
      senderService.groupForMember({ status: 'active', expiry_date: '2020-03-31' })
    ).toBe(LAPSED_GROUP);
  });

  test('an active member whose expiry date is in the future is current', () => {
    expect(
      senderService.groupForMember({ status: 'active', expiry_date: '2099-03-31' })
    ).toBe(CURRENT_GROUP);
  });

  test('an active member with no expiry date on file is current', () => {
    expect(senderService.groupForMember({ status: 'active', expiry_date: null })).toBe(CURRENT_GROUP);
  });

  test('a lifetime member with a stale expiry date is still current', () => {
    expect(
      senderService.groupForMember({ status: 'active', expiry_date: '2020-03-31', is_lifetime: 1 })
    ).toBe(CURRENT_GROUP);
  });

  test('a cancelled member with a future expiry date still belongs to no group', () => {
    expect(
      senderService.groupForMember({ status: 'cancelled', expiry_date: '2099-03-31' })
    ).toBeNull();
  });

  test('pending and cancelled members belong to no group', () => {
    expect(senderService.groupForMember({ status: 'pending' })).toBeNull();
    expect(senderService.groupForMember({ status: 'cancelled' })).toBeNull();
  });
});

describe('buildSubscriber', () => {
  test('normalizes email and maps custom fields', () => {
    const payload = senderService.buildSubscriber({
      email: '  Jane@Example.COM ',
      first_name: 'Jane',
      last_name: 'Doe',
      member_number: 'YSH-2025-0001',
      expiry_date: '2026-03-31',
    });
    expect(payload.email).toBe('jane@example.com');
    expect(payload.firstname).toBe('Jane');
    expect(payload.lastname).toBe('Doe');
    expect(payload.fields['{$member_number}']).toBe('YSH-2025-0001');
    expect(payload.fields['{$membership_expires}']).toBe('2026-03-31');
  });

  test('never triggers Sender automations', () => {
    const payload = senderService.buildSubscriber({ email: 'a@b.com' });
    expect(payload.trigger_automation).toBe(false);
  });

  test('omits groups so an existing Sender group is never clobbered', () => {
    const payload = senderService.buildSubscriber({ email: 'a@b.com' });
    expect(payload.groups).toBeUndefined();
  });
});

describe('dedupeByEmail', () => {
  test('prefers the primary member when a family shares an email', () => {
    const result = senderService.dedupeByEmail([
      { id: 2, email: 'shared@test.com', first_name: 'Kid', primary_member_id: 1, status: 'pending' },
      { id: 1, email: 'Shared@test.com', first_name: 'Parent', primary_member_id: null, status: 'active' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
    expect(result[0].first_name).toBe('Parent');
  });

  test('drops members with no email', () => {
    const result = senderService.dedupeByEmail([
      { id: 1, email: '', primary_member_id: null },
      { id: 2, email: null, primary_member_id: null },
      { id: 3, email: 'ok@test.com', primary_member_id: null },
    ]);
    expect(result.map(m => m.id)).toEqual([3]);
  });

  test('keeps distinct emails', () => {
    const result = senderService.dedupeByEmail([
      { id: 1, email: 'a@test.com', primary_member_id: null },
      { id: 2, email: 'b@test.com', primary_member_id: null },
    ]);
    expect(result).toHaveLength(2);
  });
});

describe('upsertSubscriber', () => {
  test('creates via POST /subscribers with a bearer token', async () => {
    await senderService.upsertSubscriber({ email: 'new@test.com', first_name: 'New', last_name: 'Guy' });

    const [call] = calls();
    expect(call.method).toBe('POST');
    expect(call.url).toBe('https://api.sender.net/v2/subscribers');
    expect(call.auth).toBe('Bearer test-token');
    expect(call.body.email).toBe('new@test.com');
  });

  test('falls back to PATCH when the subscriber already exists', async () => {
    global.fetch
      .mockResolvedValueOnce(response({ ok: false, status: 422, body: { message: 'already exists' } }))
      .mockResolvedValueOnce(response());

    await senderService.upsertSubscriber({ email: 'dupe@test.com', first_name: 'D', last_name: 'Upe' });

    const [create, update] = calls();
    expect(create.method).toBe('POST');
    expect(update.method).toBe('PATCH');
    expect(update.url).toBe('https://api.sender.net/v2/subscribers/dupe%40test.com');
  });

  test('throws with the API message on an unrecoverable error', async () => {
    global.fetch.mockResolvedValue(response({ ok: false, status: 400, body: { message: 'bad email' } }));
    await expect(
      senderService.upsertSubscriber({ email: 'bad', first_name: 'B', last_name: 'D' })
    ).rejects.toThrow('bad email');
  });

  test('retries a 429 and then succeeds', async () => {
    global.fetch
      .mockResolvedValueOnce(response({ ok: false, status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(response());

    await senderService.upsertSubscriber({ email: 'slow@test.com', first_name: 'S', last_name: 'L' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('rate limiting', () => {
  // X-RateLimit-Reset arrives as a bare integer, so it has to be read numerically —
  // Date.parse() on it is NaN, which silently degraded the pause to a flat 1s.
  test('reads X-RateLimit-Reset as epoch seconds and does not pause once it has passed', async () => {
    const pastEpochSeconds = String(Math.floor(Date.now() / 1000) - 120);
    global.fetch.mockResolvedValue(response({
      headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': pastEpochSeconds },
    }));

    const started = Date.now();
    await senderService.upsertSubscriber({ email: 'rl@test.com', first_name: 'R', last_name: 'L' });

    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('syncMember', () => {
  test('adds an active member to the current group and removes them from lapsed', async () => {
    const member = insertMember(testDb, { email: 'active@test.com', status: 'active' });

    const result = await senderService.syncMember(member.id);

    expect(result.group).toBe(CURRENT_GROUP);
    const groupCalls = calls().filter(c => c.url.includes('/subscribers/groups/'));
    expect(groupCalls).toEqual([
      expect.objectContaining({
        method: 'POST',
        url: `https://api.sender.net/v2/subscribers/groups/${CURRENT_GROUP}`,
        body: { subscribers: ['active@test.com'] },
      }),
      expect.objectContaining({
        method: 'DELETE',
        url: `https://api.sender.net/v2/subscribers/groups/${LAPSED_GROUP}`,
        body: { subscribers: ['active@test.com'] },
      }),
    ]);
  });

  test('adds to the target group before removing from the other', async () => {
    const member = insertMember(testDb, { email: 'active@test.com', status: 'active' });

    await senderService.syncMember(member.id);

    const groupCalls = calls().filter(c => c.url.includes('/subscribers/groups/'));
    expect(groupCalls[0].method).toBe('POST');
    expect(groupCalls[0].url).toContain(CURRENT_GROUP);
  });

  test('a failed group removal does not undo the group the member belongs in', async () => {
    const member = insertMember(testDb, { email: 'lapsed@test.com', status: 'expired' });

    global.fetch.mockImplementation(async (url, opts) => {
      if (opts.method === 'DELETE') {
        return response({ ok: false, status: 422, body: { message: 'not in group' } });
      }
      return response();
    });

    const result = await senderService.syncMember(member.id);

    expect(result.group).toBe(LAPSED_GROUP);
    const added = calls().find(c => c.method === 'POST' && c.url.includes('/subscribers/groups/'));
    expect(added.url).toContain(LAPSED_GROUP);
  });

  test('moves an expired member into the lapsed group', async () => {
    const member = insertMember(testDb, { email: 'lapsed@test.com', status: 'expired' });

    await senderService.syncMember(member.id);

    const groupCalls = calls().filter(c => c.url.includes('/subscribers/groups/'));
    expect(groupCalls.find(c => c.url.endsWith(CURRENT_GROUP)).method).toBe('DELETE');
    expect(groupCalls.find(c => c.url.endsWith(LAPSED_GROUP)).method).toBe('POST');
  });

  test('removes a cancelled member from both groups', async () => {
    const member = insertMember(testDb, { email: 'gone@test.com', status: 'cancelled' });

    await senderService.syncMember(member.id);

    const groupCalls = calls().filter(c => c.url.includes('/subscribers/groups/'));
    expect(groupCalls).toHaveLength(2);
    expect(groupCalls.every(c => c.method === 'DELETE')).toBe(true);
  });

  test('skips entirely when Sender is not configured', async () => {
    delete process.env.SENDER_API_TOKEN;
    const member = insertMember(testDb, { email: 'nope@test.com', status: 'active' });

    const result = await senderService.syncMember(member.id);

    expect(result.skipped).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('throws when the member has no email', async () => {
    const member = insertMember(testDb, { email: '', status: 'active' });
    await expect(senderService.syncMember(member.id)).rejects.toThrow('no email');
  });
});

describe('syncMemberSafe', () => {
  test('swallows API failures so the caller never breaks', async () => {
    global.fetch.mockResolvedValue(response({ ok: false, status: 400, body: { message: 'nope' } }));
    const member = insertMember(testDb, { email: 'fail@test.com', status: 'active' });

    await expect(senderService.syncMemberSafe(member.id)).resolves.toBeUndefined();
  });

  test('does nothing when unconfigured', async () => {
    delete process.env.SENDER_GROUP_CURRENT;
    await senderService.syncMemberSafe(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('uses the short retry budget so an HTTP handler cannot stall', async () => {
    // 5xx is retried; the request profile allows one retry, not the background four.
    global.fetch.mockResolvedValue(response({ ok: false, status: 503 }));
    const member = insertMember(testDb, { email: 'down@test.com', status: 'active' });

    await senderService.syncMemberSafe(member.id);

    const upserts = calls().filter(c => c.url === 'https://api.sender.net/v2/subscribers');
    expect(upserts).toHaveLength(2);
  });
});

describe('syncMembersSafe', () => {
  test('syncs a family sharing one email exactly once, as the primary', async () => {
    const primary = insertMember(testDb, {
      email: 'family@test.com', status: 'active', first_name: 'Parent',
    });
    const kid = insertMember(testDb, {
      email: 'family@test.com', status: 'active', first_name: 'Kid', primary_member_id: primary.id,
    });

    await senderService.syncMembersSafe([primary, kid]);

    const upserts = calls().filter(c => c.url === 'https://api.sender.net/v2/subscribers');
    expect(upserts).toHaveLength(1);
    expect(upserts[0].body.firstname).toBe('Parent');
  });

  test('syncs each distinct email', async () => {
    const a = insertMember(testDb, { email: 'a@test.com', status: 'active' });
    const b = insertMember(testDb, { email: 'b@test.com', status: 'active' });

    await senderService.syncMembersSafe([a, b]);

    const upserts = calls().filter(c => c.url === 'https://api.sender.net/v2/subscribers');
    expect(upserts.map(c => c.body.email).sort()).toEqual(['a@test.com', 'b@test.com']);
  });

  test('does nothing when unconfigured', async () => {
    delete process.env.SENDER_API_TOKEN;
    await senderService.syncMembersSafe([{ id: 1, email: 'a@test.com', primary_member_id: null }]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // A throw here would 500 the Stripe webhook, and Stripe would re-deliver the event.
  test('tolerates null entries instead of throwing into the webhook', async () => {
    const member = insertMember(testDb, { email: 'ok@test.com', status: 'active' });

    await expect(senderService.syncMembersSafe([null, member, undefined])).resolves.toBeUndefined();

    const upserts = calls().filter(c => c.url === 'https://api.sender.net/v2/subscribers');
    expect(upserts).toHaveLength(1);
  });
});

describe('syncEmailSafe', () => {
  test('drops an address from both groups when no member holds it any more', async () => {
    await senderService.syncEmailSafe('deleted@test.com');

    const groupCalls = calls().filter(c => c.url.includes('/subscribers/groups/'));
    expect(groupCalls).toHaveLength(2);
    expect(groupCalls.every(c => c.method === 'DELETE')).toBe(true);
    expect(groupCalls.every(c => c.body.subscribers[0] === 'deleted@test.com')).toBe(true);
  });

  test('re-syncs the surviving member when one still holds the address', async () => {
    insertMember(testDb, { email: 'family@test.com', status: 'active', first_name: 'Parent' });

    await senderService.syncEmailSafe('family@test.com');

    const upserts = calls().filter(c => c.url === 'https://api.sender.net/v2/subscribers');
    expect(upserts).toHaveLength(1);
    expect(upserts[0].body.firstname).toBe('Parent');
    const added = calls().find(c => c.method === 'POST' && c.url.includes('/subscribers/groups/'));
    expect(added.url).toContain(CURRENT_GROUP);
  });

  test('does nothing for a blank address or when unconfigured', async () => {
    await senderService.syncEmailSafe('');
    expect(global.fetch).not.toHaveBeenCalled();

    delete process.env.SENDER_GROUP_LAPSED;
    await senderService.syncEmailSafe('x@test.com');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('syncAllMembers', () => {
  test('upserts each member then reconciles groups in bulk', async () => {
    insertMember(testDb, { email: 'a@test.com', status: 'active' });
    insertMember(testDb, { email: 'b@test.com', status: 'expired' });
    insertMember(testDb, { email: 'c@test.com', status: 'pending' });

    const stats = await senderService.syncAllMembers();

    expect(stats.total).toBe(3);
    expect(stats.synced).toBe(3);
    expect(stats.failed).toBe(0);
    expect(stats.groups).toEqual({ current: 1, lapsed: 1, removed: 1 });

    const upserts = calls().filter(c => c.url === 'https://api.sender.net/v2/subscribers');
    expect(upserts).toHaveLength(3);

    const addCurrent = calls().find(
      c => c.method === 'POST' && c.url.endsWith(`/groups/${CURRENT_GROUP}`)
    );
    expect(addCurrent.body.subscribers).toEqual(['a@test.com']);

    const removeCurrent = calls().find(
      c => c.method === 'DELETE' && c.url.endsWith(`/groups/${CURRENT_GROUP}`)
    );
    expect(removeCurrent.body.subscribers).toEqual(expect.arrayContaining(['b@test.com', 'c@test.com']));
  });

  test('one failing member does not abort the batch', async () => {
    insertMember(testDb, { email: 'ok1@test.com', status: 'active' });
    insertMember(testDb, { email: 'boom@test.com', status: 'active' });
    insertMember(testDb, { email: 'ok2@test.com', status: 'active' });

    global.fetch.mockImplementation(async (url, opts) => {
      const body = opts.body ? JSON.parse(opts.body) : {};
      if (body.email === 'boom@test.com') {
        return response({ ok: false, status: 400, body: { message: 'rejected' } });
      }
      return response();
    });

    const stats = await senderService.syncAllMembers();

    expect(stats.synced).toBe(2);
    expect(stats.failed).toBe(1);
  });

  test('a rejected group removal does not abandon the rest of the reconciliation', async () => {
    insertMember(testDb, { email: 'a@test.com', status: 'active' });
    insertMember(testDb, { email: 'b@test.com', status: 'expired' });

    global.fetch.mockImplementation(async (url, opts) => {
      if (opts.method === 'DELETE') {
        return response({ ok: false, status: 422, body: { message: 'not in group' } });
      }
      return response();
    });

    const stats = await senderService.syncAllMembers();

    expect(stats.groups).toEqual({ current: 1, lapsed: 1, removed: 0 });
    const adds = calls().filter(c => c.method === 'POST' && c.url.includes('/subscribers/groups/'));
    expect(adds.map(c => c.url.split('/').pop()).sort()).toEqual([CURRENT_GROUP, LAPSED_GROUP].sort());
  });

  test('members whose upsert failed are left out of the group batches', async () => {
    insertMember(testDb, { email: 'ok@test.com', status: 'active' });
    insertMember(testDb, { email: 'boom@test.com', status: 'active' });

    global.fetch.mockImplementation(async (url, opts) => {
      const body = opts.body ? JSON.parse(opts.body) : {};
      if (body.email === 'boom@test.com') {
        return response({ ok: false, status: 400, body: { message: 'rejected' } });
      }
      return response();
    });

    const stats = await senderService.syncAllMembers();

    expect(stats.failed).toBe(1);
    expect(stats.groups.current).toBe(1);
    const addCurrent = calls().find(
      c => c.method === 'POST' && c.url.endsWith(`/groups/${CURRENT_GROUP}`)
    );
    expect(addCurrent.body.subscribers).toEqual(['ok@test.com']);
  });

  test('dedupes a family sharing the primary email into one subscriber', async () => {
    const primary = insertMember(testDb, { email: 'family@test.com', status: 'active', first_name: 'Parent' });
    insertMember(testDb, {
      email: 'family@test.com',
      status: 'active',
      first_name: 'Kid',
      primary_member_id: primary.id,
    });

    const stats = await senderService.syncAllMembers();

    expect(stats.total).toBe(1);
    const upserts = calls().filter(c => c.url === 'https://api.sender.net/v2/subscribers');
    expect(upserts).toHaveLength(1);
    expect(upserts[0].body.firstname).toBe('Parent');
  });

  test('dry run makes no API calls but still reports the plan', async () => {
    insertMember(testDb, { email: 'a@test.com', status: 'active' });
    insertMember(testDb, { email: 'b@test.com', status: 'expired' });

    const stats = await senderService.syncAllMembers({ dryRun: true });

    expect(stats.groups).toEqual({ current: 1, lapsed: 1, removed: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('throws when Sender is not configured', async () => {
    delete process.env.SENDER_API_TOKEN;
    await expect(senderService.syncAllMembers()).rejects.toThrow('not configured');
  });
});
