-- Track provenance separately from editable lifecycle tags.
ALTER TABLE skill_lifecycle ADD COLUMN origin TEXT NOT NULL DEFAULT 'official';
UPDATE skill_lifecycle SET origin='third_party' WHERE tags LIKE '%第三方%';
