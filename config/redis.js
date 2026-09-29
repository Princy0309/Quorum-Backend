const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    family: 0,
    enableOfflineQueue: true,
    retryStrategy: (times) => {
        return Math.min(times * 50, 2000);
    }
});
redis.on('error', (err) => console.error('Redis error:', err));
redis.on('connect', () => console.log('Redis connected successfully'));

module.exports = redis;
