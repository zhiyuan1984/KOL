-- Probability-weighted Jev ranking and transparent engagement proxy.
ALTER TABLE kol_profile_index ADD COLUMN potential_probabilities TEXT;
ALTER TABLE kol_profile_index ADD COLUMN risk_probabilities TEXT;
ALTER TABLE kol_profile_index ADD COLUMN engagement_source TEXT;
