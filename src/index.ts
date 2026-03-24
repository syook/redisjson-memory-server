import './util/resolve-config'; // import it for the side-effects (globals)

import RedisBinary from './util/RedisBinary';
import RedisInstance from './util/RedisInstance';
import RedisMemoryServer from './RedisMemoryServer';
import RedisModuleBinary from './util/RedisModuleBinary';

export default RedisMemoryServer;
export { RedisBinary, RedisInstance, RedisMemoryServer, RedisModuleBinary };