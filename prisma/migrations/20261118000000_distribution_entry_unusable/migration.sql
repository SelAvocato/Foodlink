-- Link an unusable portion to the distribution entry that recorded it, so the
-- volunteer's C9 entry CRUD can update or remove both in one operation. Rows
-- written before C9 keep a null entry_id and are left untouched.
ALTER TABLE unusable_portions
  ADD COLUMN entry_id uuid REFERENCES distribution_entries(id) ON DELETE CASCADE;

CREATE INDEX unusable_portions_entry_idx ON unusable_portions (entry_id);
