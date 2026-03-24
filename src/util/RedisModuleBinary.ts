import fs from 'fs';
import { access, mkdir, copyFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import LockFile from 'lockfile';
import findCacheDir from 'find-cache-dir';
import { execSync } from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';
import http from 'http';
import https from 'https';
import * as tar from 'tar';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { rimraf } from 'rimraf';
import resolveConfig from './resolve-config';
import { RedisModuleOpts, RedisModuleName } from '../types';
import debug from 'debug';

const log = debug('RedisMS:RedisModuleBinary');

/** Module metadata for download/build */
interface ModuleMeta {
  /** GitHub repo in format owner/repo */
  repo: string;
  /** The .so file name produced by the build */
  binaryName: string;
  /** Build command to run after cloning/extracting */
  buildCommand: string;
  /** Path within the build directory to find the binary */
  binaryPath: string;
  /** Whether the module requires Rust/Cargo to build */
  requiresRust: boolean;
}

const MODULE_REGISTRY: Record<RedisModuleName, ModuleMeta> = {
  rejson: {
    repo: 'RedisJSON/RedisJSON',
    binaryName: 'librejson.so',
    buildCommand: 'cargo build --release',
    binaryPath: 'target/release/librejson.so',
    requiresRust: true,
  },
};

export interface RedisModuleBinaryCache {
  [key: string]: string; // "moduleName-version" -> path
}

export default class RedisModuleBinary {
  static cache: RedisModuleBinaryCache = {};

  /**
   * Get a cache key for a module
   */
  static getCacheKey(name: RedisModuleName, version: string): string {
    return `${name}-${version}`;
  }

  /**
   * Check if the module binary is already cached
   */
  static getCachePath(name: RedisModuleName, version: string): string | undefined {
    return this.cache[this.getCacheKey(name, version)];
  }

  /**
   * Probe if the provided system module path exists
   */
  static async getSystemPath(systemModule: string): Promise<string> {
    let modulePath = '';
    try {
      await access(systemModule);
      log(`RedisModuleBinary: found system module at "${systemModule}"`);
      modulePath = systemModule;
    } catch (err: any) {
      log(`RedisModuleBinary: can't find system module at "${systemModule}".\n${err?.message}`);
    }
    return modulePath;
  }

  /**
   * Get the default download directory for modules
   */
  static getDefaultDownloadDir(): string {
    const configDir = resolveConfig('MODULE_DOWNLOAD_DIR');
    if (configDir) {
      return configDir;
    }

    const cacheDir = findCacheDir({ name: 'redis-memory-server' });
    if (cacheDir) {
      return path.resolve(cacheDir, 'redis-modules');
    }

    return path.resolve(os.homedir(), '.cache', 'redis-memory-server', 'redis-modules');
  }

  /**
   * Check if the Redis version is 8+ (modules are built-in)
   * @param redisVersion The Redis version string
   */
  static isModuleBuiltIn(redisVersion: string): boolean {
    const match = redisVersion.match(/^(\d+)/);
    if (match) {
      return parseInt(match[1], 10) >= 8;
    }
    // "stable" could be 8+, but we can't know for sure
    // Return false to be safe; user can use enableJSON with Redis 8 binary
    return false;
  }

  /**
   * Resolve the path for a module binary.
   * Order: systemModule -> cache -> download/build
   */
  static async getPath(opts: RedisModuleOpts): Promise<string> {
    const { name, version = 'latest', systemModule, downloadDir } = opts;

    const meta = MODULE_REGISTRY[name];
    if (!meta) {
      throw new Error(`RedisModuleBinary: unsupported module "${name}"`);
    }

    // 1. Check system module path
    if (systemModule) {
      const sysPath = await this.getSystemPath(systemModule);
      if (sysPath) {
        return sysPath;
      }
      log(`System module path "${systemModule}" not found, falling back to download`);
    }

    // 2. Check env variable for system module
    const envSystemModule = resolveConfig(`MODULE_${name.toUpperCase()}_SYSTEM_BINARY`);
    if (envSystemModule) {
      const sysPath = await this.getSystemPath(envSystemModule);
      if (sysPath) {
        return sysPath;
      }
    }

    // 3. Check cache
    const cached = this.getCachePath(name, version);
    if (cached) {
      log(`RedisModuleBinary: using cached module at "${cached}"`);
      return cached;
    }

    // 4. Download and build
    const resolvedDownloadDir = downloadDir || this.getDefaultDownloadDir();
    const modulePath = await this.downloadAndBuild(name, version, resolvedDownloadDir, meta);

    // Cache it
    this.cache[this.getCacheKey(name, version)] = modulePath;
    return modulePath;
  }

  /**
   * Download and build a module from source
   */
  static async downloadAndBuild(
    name: RedisModuleName,
    version: string,
    downloadDir: string,
    meta: ModuleMeta
  ): Promise<string> {
    const moduleDir = path.resolve(downloadDir, name, version);
    const binaryDest = path.resolve(moduleDir, meta.binaryName);

    // Create directories
    await mkdir(moduleDir, { recursive: true });

    // Lock file to prevent concurrent builds
    const lockfile = path.resolve(downloadDir, `${name}-${version}.lock`);
    await new Promise((resolve, reject) => {
      LockFile.lock(
        lockfile,
        {
          wait: 1000 * 300, // 5 minutes - module builds can be slow
          pollPeriod: 100,
          stale: 1000 * 290,
          retries: 3,
          retryWait: 100,
        },
        (err: any) => (err ? reject(err) : resolve(null))
      );
    });

    try {
      // Check if already built
      try {
        await access(binaryDest);
        log(`Module ${name} already built at "${binaryDest}"`);
        this.cache[this.getCacheKey(name, version)] = binaryDest;
        return binaryDest;
      } catch {
        // Not yet built, continue
      }

      if (meta.requiresRust) {
        await this.ensureRustInstalled();
      }

      // Download source
      const sourceDir = await this.downloadSource(meta.repo, version, moduleDir);

      // Build
      log(`Building module ${name} (version: ${version})...`);
      console.log(`Building Redis module ${name}... (this may take a few minutes)`);

      await promisify(exec)(meta.buildCommand, {
        cwd: sourceDir,
        env: {
          ...process.env,
          // Ensure cargo is on PATH
          PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}`,
        },
      });

      // Copy binary to destination
      const builtBinary = path.resolve(sourceDir, meta.binaryPath);
      try {
        await access(builtBinary);
      } catch {
        throw new Error(
          `RedisModuleBinary: build succeeded but binary not found at "${builtBinary}"`
        );
      }
      await copyFile(builtBinary, binaryDest);

      // Clean up source
      await rimraf(sourceDir);

      log(`Module ${name} built successfully at "${binaryDest}"`);
      this.cache[this.getCacheKey(name, version)] = binaryDest;
      return binaryDest;
    } finally {
      // Release lock
      await new Promise<void>((res) => {
        LockFile.unlock(lockfile, (err) => {
          if (err) {
            log(`RedisModuleBinary: Error removing lock: ${err}`);
          }
          res();
        });
      });
    }
  }

  /**
   * Download module source from GitHub
   */
  static async downloadSource(
    repo: string,
    version: string,
    moduleDir: string
  ): Promise<string> {
    const extractDir = path.resolve(moduleDir, 'source');

    // Clean up any previous source
    await rimraf(extractDir);
    await mkdir(extractDir, { recursive: true });

    // Build tarball URL
    const ref = version === 'latest' ? 'master' : `v${version}`;
    const tarballUrl = `https://github.com/${repo}/archive/refs/heads/${ref}.tar.gz`;
    const tagTarballUrl = `https://github.com/${repo}/archive/refs/tags/v${version}.tar.gz`;

    // Try tag URL first (for versioned releases), fall back to branch
    const downloadUrl = version === 'latest' ? tarballUrl : tagTarballUrl;

    log(`Downloading ${repo} source from ${downloadUrl}`);

    const archivePath = path.resolve(moduleDir, 'source.tar.gz');

    await this.httpDownload(downloadUrl, archivePath);

    // Extract
    await tar.extract({
      file: archivePath,
      cwd: extractDir,
      strip: 1,
    });

    // Clean up archive
    fs.unlinkSync(archivePath);

    return extractDir;
  }

  /**
   * Download a file via HTTP(S) with redirect support
   */
  static async httpDownload(downloadUrl: string, destination: string): Promise<void> {
    const proxy =
      process.env['yarn_https-proxy'] ||
      process.env.yarn_proxy ||
      process.env['npm_config_https-proxy'] ||
      process.env.npm_config_proxy ||
      process.env.https_proxy ||
      process.env.http_proxy ||
      process.env.HTTPS_PROXY ||
      process.env.HTTP_PROXY;

    return new Promise((resolve, reject) => {
      const doRequest = (url: string, redirectCount: number = 0) => {
        if (redirectCount > 5) {
          reject(new Error('Too many redirects'));
          return;
        }

        const parsedUrl = new URL(url);
        const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
        const httpModule = parsedUrl.protocol === 'https:' ? https : http;

        httpModule
          .get(
            {
              hostname: parsedUrl.hostname,
              port: parsedUrl.port,
              path: parsedUrl.pathname + parsedUrl.search,
              headers: { 'User-Agent': 'redis-memory-server' },
              agent,
            },
            (response) => {
              // Handle redirects
              if (
                response.statusCode &&
                response.statusCode >= 300 &&
                response.statusCode < 400 &&
                response.headers.location
              ) {
                doRequest(response.headers.location, redirectCount + 1);
                return;
              }

              if (response.statusCode !== 200) {
                reject(
                  new Error(
                    `Failed to download ${url}: HTTP ${response.statusCode}`
                  )
                );
                return;
              }

              const fileStream = fs.createWriteStream(destination);
              response.pipe(fileStream);
              fileStream.on('finish', () => {
                fileStream.close();
                resolve();
              });
              fileStream.on('error', reject);
            }
          )
          .on('error', reject);
      };

      doRequest(downloadUrl);
    });
  }

  /**
   * Ensure Rust/Cargo is installed (required for building RedisJSON)
   */
  static async ensureRustInstalled(): Promise<void> {
    try {
      execSync('cargo --version', {
        stdio: 'pipe',
        env: {
          ...process.env,
          PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}`,
        },
      });
      log('Rust/Cargo is already installed');
    } catch {
      throw new Error(
        'RedisModuleBinary: Rust/Cargo is required to build RedisJSON but is not installed.\n' +
          'Install it from https://rustup.rs/ or use a pre-built module binary:\n' +
          '  new RedisMemoryServer({ modules: { modules: [{ name: "rejson", systemModule: "/path/to/librejson.so" }] } })\n' +
          'Or set REDISMS_MODULE_REJSON_SYSTEM_BINARY=/path/to/librejson.so'
      );
    }
  }
}