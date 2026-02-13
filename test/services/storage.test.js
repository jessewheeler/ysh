const mockSend = jest.fn().mockResolvedValue({});

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockSend })),
  PutObjectCommand: jest.fn((params) => ({ ...params, _type: 'PutObject' })),
  DeleteObjectCommand: jest.fn((params) => ({ ...params, _type: 'DeleteObject' })),
}));

const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const B2_ENV = {
  B2_ENDPOINT: 'https://s3.us-west-004.backblazeb2.com',
  B2_REGION: 'us-west-004',
  B2_BUCKET: 'ysh-uploads',
  B2_KEY_ID: 'test-key-id',
  B2_APP_KEY: 'test-app-key',
  B2_PUBLIC_URL: 'https://f005.backblazeb2.com/file/ysh-uploads',
};

let storage;

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockResolvedValue({});

  // Set all B2 env vars
  Object.assign(process.env, B2_ENV);

  // Re-require to get fresh module
  jest.isolateModules(() => {
    storage = require('../../services/storage');
  });
});

afterEach(() => {
  // Clean up env vars
  for (const key of Object.keys(B2_ENV)) {
    delete process.env[key];
  }
});

describe('isConfigured', () => {
  test('returns true when all B2 env vars are set', () => {
    expect(storage.isConfigured()).toBe(true);
  });

  test('returns false when a B2 env var is missing', () => {
    delete process.env.B2_BUCKET;
    expect(storage.isConfigured()).toBe(false);
  });

  test('returns false when no B2 env vars are set', () => {
    for (const key of Object.keys(B2_ENV)) {
      delete process.env[key];
    }
    expect(storage.isConfigured()).toBe(false);
  });
});

describe('uploadFile', () => {
  test('sends PutObjectCommand with correct params', async () => {
    const buffer = Buffer.from('image-data');
    await storage.uploadFile(buffer, 'photo.jpg', 'gallery');

    expect(PutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'ysh-uploads',
        Body: buffer,
        ContentType: 'image/jpeg',
      })
    );
    const putParams = PutObjectCommand.mock.calls[0][0];
    expect(putParams.Key).toMatch(/^gallery\/\d+-[a-f0-9]+\.jpg$/);
  });

  test('returns public URL', async () => {
    const url = await storage.uploadFile(Buffer.from('data'), 'test.png', 'bios');
    expect(url).toMatch(/^https:\/\/f005\.backblazeb2\.com\/file\/ysh-uploads\/bios\/\d+-[a-f0-9]+\.png$/);
  });

  test('generates unique filenames', async () => {
    const url1 = await storage.uploadFile(Buffer.from('a'), 'img.jpg', 'gallery');
    const url2 = await storage.uploadFile(Buffer.from('b'), 'img.jpg', 'gallery');
    expect(url1).not.toBe(url2);
  });

  test('creates S3Client with correct config', async () => {
    await storage.uploadFile(Buffer.from('x'), 'f.jpg', 'gallery');
    expect(S3Client).toHaveBeenCalledWith({
      endpoint: B2_ENV.B2_ENDPOINT,
      region: B2_ENV.B2_REGION,
      credentials: {
        accessKeyId: B2_ENV.B2_KEY_ID,
        secretAccessKey: B2_ENV.B2_APP_KEY,
      },
    });
  });

  test('sets correct content type for webp', async () => {
    await storage.uploadFile(Buffer.from('x'), 'photo.webp', 'gallery');
    expect(PutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({ ContentType: 'image/webp' })
    );
  });

  test('propagates S3 errors', async () => {
    mockSend.mockRejectedValueOnce(new Error('S3 failure'));
    await expect(storage.uploadFile(Buffer.from('x'), 'f.jpg', 'gallery')).rejects.toThrow('S3 failure');
  });
});

describe('deleteFile', () => {
  test('sends DeleteObjectCommand for B2 URLs', async () => {
    await storage.deleteFile('https://f005.backblazeb2.com/file/ysh-uploads/gallery/123-abc.jpg');

    expect(DeleteObjectCommand).toHaveBeenCalledWith({
      Bucket: 'ysh-uploads',
      Key: 'gallery/123-abc.jpg',
    });
    expect(mockSend).toHaveBeenCalled();
  });

  test('skips local paths', async () => {
    await storage.deleteFile('/uploads/123-456.jpg');
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('skips seed image paths', async () => {
    await storage.deleteFile('/img/gallery/seahawks.jpg');
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('skips null values', async () => {
    await storage.deleteFile(null);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('skips undefined values', async () => {
    await storage.deleteFile(undefined);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('skips when B2 is not configured', async () => {
    delete process.env.B2_BUCKET;
    await storage.deleteFile('https://f005.backblazeb2.com/file/ysh-uploads/gallery/123.jpg');
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('propagates S3 errors', async () => {
    mockSend.mockRejectedValueOnce(new Error('Delete failed'));
    await expect(
      storage.deleteFile('https://f005.backblazeb2.com/file/ysh-uploads/gallery/123.jpg')
    ).rejects.toThrow('Delete failed');
  });
});
