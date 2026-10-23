# PostgreSQL image for the cloud stack and the offline-store distribution (ADR-0005).
# Pinned by version + digest; update deliberately (ADR-0005: base image updates).
FROM postgres:17.11-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24
COPY initdb/ /docker-entrypoint-initdb.d/
# Client authentication of test and prod (security review 2026-10-22, Z6); dev keeps the default of the image.
COPY pg_hba.conf /etc/pharmacy/pg_hba.conf
# Backups (ADR-0019): the script runs in the `backup` service (copies) and in this container (restore). The
# named volume backup-scratch takes the owner of /scratch from the image.
COPY --chmod=0755 backup/pharmacy-backup /usr/local/bin/
RUN install -d -o postgres -g postgres -m 700 /backups /scratch
