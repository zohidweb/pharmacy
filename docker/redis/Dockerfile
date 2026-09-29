# Redis image: sessions and cache (stack.md). Loss of data is acceptable (C4 deployment) — no persistence.
# Pinned by version + digest; update deliberately (ADR-0005: base image updates).
FROM redis:7.4.11-alpine@sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499
COPY redis.conf /usr/local/etc/redis/redis.conf
# Password is passed at runtime: --requirepass "$REDIS_PASSWORD" (docker/compose.yml)
CMD ["redis-server", "/usr/local/etc/redis/redis.conf"]
