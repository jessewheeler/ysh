const campaigns = require('../../services/campaigns');

describe('services/campaigns validateCampaign', () => {
  const valid = {name: 'Watch Party Flyer', utm_campaign: 'flyer26'};

  it('normalizes a valid submission', () => {
    const result = campaigns.validateCampaign({
      ...valid,
      utm_campaign: 'FLYER26',
      utm_source: ' print ',
      utm_medium: '',
      notes: '  ',
    });
    expect(result).toEqual({
      name: 'Watch Party Flyer',
      utm_campaign: 'flyer26',
      utm_source: 'print',
      utm_medium: null,
      utm_content: null,
      target_path: '/membership',
      notes: null,
    });
  });

  it('requires a name', () => {
    expect(() => campaigns.validateCampaign({utm_campaign: 'x'})).toThrow(/name is required/i);
  });

  it('requires a campaign code', () => {
    expect(() => campaigns.validateCampaign({name: 'X'})).toThrow(/code .*is required/i);
  });

  it('rejects codes with illegal characters', () => {
    for (const code of ['has space', 'has/slash', 'qué', 'a+b']) {
      expect(() => campaigns.validateCampaign({...valid, utm_campaign: code}))
        .toThrow(/lowercase letters, numbers/i);
    }
  });

  it('accepts dots, dashes and underscores in codes', () => {
    const result = campaigns.validateCampaign({...valid, utm_campaign: 'fall-26_watch.party'});
    expect(result.utm_campaign).toBe('fall-26_watch.party');
  });

  it('requires target_path to start with a slash', () => {
    expect(() => campaigns.validateCampaign({...valid, target_path: 'membership'}))
      .toThrow(/must start with/i);
  });

  it('rejects protocol-relative and absolute target paths', () => {
    expect(() => campaigns.validateCampaign({...valid, target_path: '//evil.example.com'}))
      .toThrow(/path on this site/i);
    expect(() => campaigns.validateCampaign({...valid, target_path: '/https://evil.example.com'}))
      .toThrow(/path on this site/i);
  });

  it('defaults target_path to /membership', () => {
    expect(campaigns.validateCampaign(valid).target_path).toBe('/membership');
  });
});

describe('services/campaigns buildUrl', () => {
  const base = 'https://ysh.example.com';

  it('appends only the non-empty UTM params, in canonical order', () => {
    const url = campaigns.buildUrl({
      target_path: '/membership',
      utm_campaign: 'flyer26',
      utm_source: 'print',
      utm_medium: null,
      utm_content: '',
    }, base);
    expect(url).toBe('https://ysh.example.com/membership?utm_source=print&utm_campaign=flyer26');
  });

  it('includes every param when all are set', () => {
    const url = campaigns.buildUrl({
      target_path: '/',
      utm_campaign: 'fb26',
      utm_source: 'facebook',
      utm_medium: 'post',
      utm_content: 'variant-a',
    }, base);
    expect(url).toBe(
      'https://ysh.example.com/?utm_source=facebook&utm_medium=post&utm_campaign=fb26&utm_content=variant-a'
    );
  });

  it('preserves a query string already on the target path', () => {
    const url = campaigns.buildUrl({target_path: '/membership?type=family', utm_campaign: 'flyer26'}, base);
    expect(url).toContain('type=family');
    expect(url).toContain('utm_campaign=flyer26');
  });

  it('falls back to /membership when target_path is missing', () => {
    expect(campaigns.buildUrl({utm_campaign: 'x'}, base)).toBe('https://ysh.example.com/membership?utm_campaign=x');
  });
});

describe('services/campaigns clampSize', () => {
  it('clamps to the allowed range and defaults on garbage', () => {
    expect(campaigns.clampSize('99999')).toBe(campaigns.MAX_QR_SIZE);
    expect(campaigns.clampSize('1')).toBe(campaigns.MIN_QR_SIZE);
    expect(campaigns.clampSize('300')).toBe(300);
    expect(campaigns.clampSize('abc')).toBe(campaigns.DEFAULT_QR_SIZE);
    expect(campaigns.clampSize(undefined)).toBe(campaigns.DEFAULT_QR_SIZE);
  });
});

describe('services/campaigns QR generation', () => {
  it('produces a PNG buffer', async () => {
    const png = await campaigns.qrPng('https://ysh.example.com/membership?utm_campaign=flyer26', {size: 300});
    expect(Buffer.isBuffer(png)).toBe(true);
    // PNG magic bytes
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it('produces an SVG string', async () => {
    const svg = await campaigns.qrSvg('https://ysh.example.com/membership?utm_campaign=flyer26');
    expect(typeof svg).toBe('string');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('names downloads after the campaign code', () => {
    expect(campaigns.qrFilename({utm_campaign: 'flyer26'}, 'png')).toBe('ysh-qr-flyer26.png');
    expect(campaigns.qrFilename({utm_campaign: 'flyer26'}, 'svg')).toBe('ysh-qr-flyer26.svg');
  });
});

describe('services/campaigns conversionRate', () => {
  it('renders a dash rather than a fake 0% when there are no visits', () => {
    expect(campaigns.conversionRate({visit_count: 0, signup_count: 0})).toBe('—');
  });

  it('rounds signups per visit', () => {
    expect(campaigns.conversionRate({visit_count: 10, signup_count: 3})).toBe('30%');
    expect(campaigns.conversionRate({visit_count: 3, signup_count: 1})).toBe('33%');
  });
});
