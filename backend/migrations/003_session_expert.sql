-- Session ↔ published Expert (DigitalEmployee) binding.
-- db.ts applies the same idempotent add() for embedded deployments.
-- expert_id is nullable; unset sessions are not bound to an ExpertManifest.
-- Summon writes this column only. It does not send mail, write stage, or call LIVE Gateway.

ALTER TABLE sessions ADD COLUMN expert_id TEXT;
