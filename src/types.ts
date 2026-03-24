export type DebugFn = (...args: any[]) => any;
export type DebugPropT = boolean;

export interface DownloadProgressT {
  current: number;
  length: number;
  totalMb: number;
  lastPrintedAt: number;
}

export type CallbackFn = (...args: any[]) => any;

export { SpawnOptions } from 'child_process';

export interface RedisMemoryInstancePropBaseT {
  args?: string[];
  port?: number | null;
}

export interface RedisMemoryInstancePropT extends RedisMemoryInstancePropBaseT {
  ip?: string; // for binding to all IP addresses set it to `::,0.0.0.0`, by default '127.0.0.1'
}

export type ErrorVoidCallback = (err: any) => void;
export type EmptyVoidCallback = () => void;

/**
 * Supported Redis module names
 */
export type RedisModuleName = 'rejson';

/**
 * Options for a single Redis module
 */
export interface RedisModuleOpts {
  /** The module name (e.g. 'rejson') */
  name: RedisModuleName;
  /** Version of the module to download (default: 'latest') */
  version?: string;
  /** Path to a pre-built module binary (.so file) — skips download/build */
  systemModule?: string;
  /** Custom download directory for the module binary */
  downloadDir?: string;
  /** Additional args to pass after the module path in --loadmodule */
  args?: string[];
}

/**
 * Module configuration for RedisMemoryServer
 */
export interface RedisModulesOpts {
  /** Enable specific modules */
  modules?: RedisModuleOpts[];
  /**
   * Shorthand: set to true to enable RedisJSON with default settings.
   * Equivalent to modules: [{ name: 'rejson' }]
   */
  enableJSON?: boolean;
}