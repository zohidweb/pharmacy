# PostgreSQL image for the cloud stack and the offline-store distribution (ADR-0005).
# Pinned by version + digest; update deliberately (ADR-0005: base image updates).
FROM postgres:17.11-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24
COPY initdb/ /docker-entrypoint-initdb.d/
