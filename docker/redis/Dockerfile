# Redis image: sessions and cache (stack.md). Loss of data is acceptable (C4 deployment) — no persistence.
FROM redis:7.4-alpine
COPY redis.conf /usr/local/etc/redis/redis.conf
# Password is passed at runtime: --requirepass "$REDIS_PASSWORD" (docker/compose.yml)
CMD ["redis-server", "/usr/local/etc/redis/redis.conf"]
