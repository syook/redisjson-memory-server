import RedisMemoryServer from '../RedisMemoryServer';
import RedisModuleBinary from '../util/RedisModuleBinary';

jest.setTimeout(600000);

jest.mock('../util/RedisModuleBinary');
const mockedGetPath = jest.mocked(RedisModuleBinary.getPath);

describe('RedisMemoryServer modules', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('_resolveModulePaths()', () => {
    it('should return empty array when no modules configured', async () => {
      const server = new RedisMemoryServer({ autoStart: false });
      const paths = await server._resolveModulePaths();
      expect(paths).toEqual([]);
      expect(mockedGetPath).not.toHaveBeenCalled();
    });

    it('should return empty array when modules object is empty', async () => {
      const server = new RedisMemoryServer({ autoStart: false, modules: {} });
      const paths = await server._resolveModulePaths();
      expect(paths).toEqual([]);
      expect(mockedGetPath).not.toHaveBeenCalled();
    });

    it('should handle enableJSON shorthand', async () => {
      mockedGetPath.mockResolvedValue('/mocked/path/librejson.so');

      const server = new RedisMemoryServer({
        autoStart: false,
        modules: { enableJSON: true },
      });

      const paths = await server._resolveModulePaths();
      expect(paths).toHaveLength(1);
      expect(paths[0]).toBe('/mocked/path/librejson.so');
      expect(mockedGetPath).toHaveBeenCalledWith({ name: 'rejson' });
    });

    it('should not duplicate modules when both enableJSON and explicit rejson are set', async () => {
      mockedGetPath.mockResolvedValue('/mocked/path/librejson.so');

      const server = new RedisMemoryServer({
        autoStart: false,
        modules: {
          enableJSON: true,
          modules: [{ name: 'rejson' }],
        },
      });

      const paths = await server._resolveModulePaths();
      expect(paths).toHaveLength(1);
      // getPath should only be called once since duplicates are removed
      expect(mockedGetPath).toHaveBeenCalledTimes(1);
    });

    it('should append module args to path', async () => {
      mockedGetPath.mockResolvedValue('/mocked/path/librejson.so');

      const server = new RedisMemoryServer({
        autoStart: false,
        modules: {
          modules: [{ name: 'rejson', args: ['SOME_OPT', 'value'] }],
        },
      });

      const paths = await server._resolveModulePaths();
      expect(paths).toHaveLength(1);
      expect(paths[0]).toBe('/mocked/path/librejson.so SOME_OPT value');
    });

    it('should pass full module options to getPath', async () => {
      mockedGetPath.mockResolvedValue('/custom/path/librejson.so');

      const server = new RedisMemoryServer({
        autoStart: false,
        modules: {
          modules: [
            {
              name: 'rejson',
              version: '2.6.0',
              systemModule: '/custom/path/librejson.so',
              downloadDir: '/custom/download',
            },
          ],
        },
      });

      const paths = await server._resolveModulePaths();
      expect(paths).toHaveLength(1);
      expect(mockedGetPath).toHaveBeenCalledWith({
        name: 'rejson',
        version: '2.6.0',
        systemModule: '/custom/path/librejson.so',
        downloadDir: '/custom/download',
      });
    });
  });

  describe('constructor with modules', () => {
    it('should accept modules option', () => {
      const server = new RedisMemoryServer({
        autoStart: false,
        modules: {
          enableJSON: true,
        },
      });
      expect(server.opts.modules).toBeDefined();
      expect(server.opts.modules?.enableJSON).toBe(true);
    });

    it('should accept explicit modules list', () => {
      const server = new RedisMemoryServer({
        autoStart: false,
        modules: {
          modules: [
            {
              name: 'rejson',
              systemModule: '/path/to/librejson.so',
            },
          ],
        },
      });
      expect(server.opts.modules?.modules).toHaveLength(1);
      expect(server.opts.modules?.modules?.[0].name).toBe('rejson');
    });
  });
});