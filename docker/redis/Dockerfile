# Redis image: sessions and cache (stack.md). Loss of data is acceptable (C4 deployment) — no persistence.
# Pinned by version + digest; update deliberately (ADR-0005: base image updates).
FROM redis:7.4.11-alpine@sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499
COPY redis.conf /usr/local/etc/redis/redis.conf
# The password is given at runtime (ADR-0021): an ACL file with its SHA-256 in test and prod
# (docker/compose.secrets.yml), --requirepass in dev (docker/compose.dev.yml)
CMD ["redis-server", "/usr/local/etc/redis/redis.conf"]
