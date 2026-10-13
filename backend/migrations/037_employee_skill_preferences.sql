-- Personal organisation only; this table never grants skill or Agent access.
CREATE TABLE IF NOT EXISTS employee_skill_preferences (
  user_id text NOT NULL,
  skill_id text NOT NULL,
  favorite boolean NOT NULL DEFAULT false,
  viewed_at timestamptz,
  PRIMARY KEY (user_id, skill_id)
);
