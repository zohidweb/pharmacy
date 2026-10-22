-- Up Migration
-- Security review 2026-10-22 (spec 2026-10-21-pos-offline-limits, У17): the opening of a shift reads the last closing
-- of its terminal (ShiftsRepository.lastClosedAt) twice; a partial index of the closed shifts by the closing time makes
-- max(closed_at) one row of a backward scan instead of every shift of the terminal (about 365 a year).
set local lock_timeout = '5s';
create index shifts_terminal_closed_idx on pharmacy.shifts (tenant_id, terminal_id, closed_at)
  where status = 'closed';
