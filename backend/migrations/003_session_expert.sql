-- Session ↔ published Expert binding (DigitalEmployee / 数字员工).
-- db.ts applies the same idempotent add() for embedded deployments.
-- expert_id + expert_version are nullable; unset sessions are not bound.
-- Summon writes these columns only. It does not send mail, write stage, or call LIVE Gateway.

ALTER TABLE sessions ADD COLUMN expert_id TEXT;
ALTER TABLE sessions ADD COLUMN expert_version TEXT;
