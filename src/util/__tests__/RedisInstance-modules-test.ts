import RedisInstance from '../RedisInstance';

describe('RedisInstance with modules', () => {
  describe('prepareCommandArgs()', () => {
    it('should include --loadmodule when modulePaths are provided', () => {
      const instance = new RedisInstance({
        instance: {
          port: 6379,
          ip: '127.0.0.1',
        },
        modulePaths: ['/path/to/librejson.so'],
      });
      const args = instance.prepareCommandArgs();

      expect(args).toContain('--loadmodule');
      expect(args).toContain('/path/to/librejson.so');

      // Verify order: --loadmodule should come before the path
      const loadmoduleIdx = args.indexOf('--loadmodule');
      expect(args[loadmoduleIdx + 1]).toBe('/path/to/librejson.so');
    });

    it('should include multiple --loadmodule entries for multiple modules', () => {
      const instance = new RedisInstance({
        instance: {
          port: 6379,
          ip: '127.0.0.1',
        },
        modulePaths: ['/path/to/librejson.so', '/path/to/redisearch.so'],
      });
      const args = instance.prepareCommandArgs();

      const loadmoduleIndices = args.reduce<number[]>((indices, arg, i) => {
        if (arg === '--loadmodule') indices.push(i);
        return indices;
      }, []);

      expect(loadmoduleIndices).toHaveLength(2);
      expect(args[loadmoduleIndices[0] + 1]).toBe('/path/to/librejson.so');
      expect(args[loadmoduleIndices[1] + 1]).toBe('/path/to/redisearch.so');
    });

    it('should not include --loadmodule when modulePaths is empty', () => {
      const instance = new RedisInstance({
        instance: {
          port: 6379,
          ip: '127.0.0.1',
        },
        modulePaths: [],
      });
      const args = instance.prepareCommandArgs();
      expect(args).not.toContain('--loadmodule');
    });

    it('should not include --loadmodule when modulePaths is undefined', () => {
      const instance = new RedisInstance({
        instance: {
          port: 6379,
          ip: '127.0.0.1',
        },
      });
      const args = instance.prepareCommandArgs();
      expect(args).not.toContain('--loadmodule');
    });

    it('should preserve other args alongside module loading', () => {
      const instance = new RedisInstance({
        instance: {
          port: 6379,
          ip: '127.0.0.1',
          args: ['--maxmemory', '100mb'],
        },
        modulePaths: ['/path/to/librejson.so'],
      });
      const args = instance.prepareCommandArgs();

      expect(args).toContain('--loadmodule');
      expect(args).toContain('/path/to/librejson.so');
      expect(args).toContain('--maxmemory');
      expect(args).toContain('100mb');
      expect(args).toContain('--save');
    });
  });
});