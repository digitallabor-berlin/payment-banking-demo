-- Hand-edited, deliberately. `drizzle-kit generate` emitted a full table
-- rebuild (because `dc_api_protocol` was declared next to
-- `dc_api_request_json` rather than appended), and its `INSERT … SELECT` listed
-- the new column on BOTH sides — selecting a column the old table does not
-- have. That is unrunnable (`no such column: dc_api_protocol`) and would break
-- every test in schema.test.ts, not only the new ones. A plain ADD is all the
-- change needs; the column is nullable, so there is nothing to backfill.
ALTER TABLE `payment_sessions` ADD `dc_api_protocol` text;