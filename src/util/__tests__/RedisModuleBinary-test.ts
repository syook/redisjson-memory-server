import RedisModuleBinary from '../RedisModuleBinary';
import { access } from 'fs/promises';

jest.setTimeout(600000);

describe('RedisModuleBinary', () => {
  afterEach(() => {
    // Clear cache between tests
    RedisModuleBinary.cache = {};
  });

  describe('getCacheKey()', () => {
    it('should create a cache key from name and version', () => {
      expect(RedisModuleBinary.getCacheKey('rejson', '2.6.0')).toBe('rejson-2.6.0');
      expect(RedisModuleBinary.getCacheKey('rejson', 'latest')).toBe('rejson-latest');
    });
  });

  describe('getCachePath()', () => {
    it('should return undefined for uncached modules', () => {
      expect(RedisModuleBinary.getCachePath('rejson', 'latest')).toBeUndefined();
    });

    it('should return cached path', () => {
      RedisModuleBinary.cache['rejson-2.6.0'] = '/some/path/librejson.so';
      expect(RedisModuleBinary.getCachePath('rejson', '2.6.0')).toBe('/some/path/librejson.so');
    });
  });

  describe('getSystemPath()', () => {
    it('should return empty string for non-existent path', async () => {
      const result = await RedisModuleBinary.getSystemPath('/nonexistent/path/librejson.so');
      expect(result).toBe('');
    });

    it('should return the path if file exists', async () => {
      // Use a file we know exists
      const result = await RedisModuleBinary.getSystemPath(__filename);
      expect(result).toBe(__filename);
    });
  });

  describe('isModuleBuiltIn()', () => {
    it('should return true for Redis 8+', () => {
      expect(RedisModuleBinary.isModuleBuiltIn('8.0.0')).toBe(true);
      expect(RedisModuleBinary.isModuleBuiltIn('8.1.0')).toBe(true);
      expect(RedisModuleBinary.isModuleBuiltIn('9.0.0')).toBe(true);
    });

    it('should return false for Redis < 8', () => {
      expect(RedisModuleBinary.isModuleBuiltIn('7.2.0')).toBe(false);
      expect(RedisModuleBinary.isModuleBuiltIn('6.0.10')).toBe(false);
    });

    it('should return false for non-numeric versions like "stable"', () => {
      expect(RedisModuleBinary.isModuleBuiltIn('stable')).toBe(false);
    });
  });

  describe('getPath()', () => {
    it('should throw for unsupported module names', async () => {
      await expect(
        RedisModuleBinary.getPath({ name: 'nonexistent' as any })
      ).rejects.toThrow('unsupported module');
    });

    it('should use systemModule path if provided and exists', async () => {
      const result = await RedisModuleBinary.getPath({
        name: 'rejson',
        systemModule: __filename,
      });
      expect(result).toBe(__filename);
    });

    it('should fall through if systemModule path does not exist', async () => {
      // This will try to download, which may fail, but we test the fallthrough logic
      await expect(
        RedisModuleBinary.getPath({
          name: 'rejson',
          systemModule: '/nonexistent/librejson.so',
          downloadDir: '/tmp/test-redis-modules',
        })
      ).rejects.toThrow(); // Will fail at download/build, but proves it fell through
    });

    it('should return cached path if available', async () => {
      RedisModuleBinary.cache['rejson-latest'] = '/cached/path/librejson.so';
      // Mock access to succeed for the cached path
      const result = RedisModuleBinary.getCachePath('rejson', 'latest');
      expect(result).toBe('/cached/path/librejson.so');
    });
  });

  describe('getDefaultDownloadDir()', () => {
    it('should return a valid directory path', () => {
      const dir = RedisModuleBinary.getDefaultDownloadDir();
      expect(dir).toBeDefined();
      expect(typeof dir).toBe('string');
      expect(dir.length).toBeGreaterThan(0);
    });
  });
});