-- Hand-edited after `drizzle-kit generate`.
--
-- drizzle-kit emits `ADD <col> NOT NULL` with no DEFAULT. SQLite accepts that
-- only while the table is empty; against any database that already holds
-- products it fails with "Cannot add a NOT NULL column with default value
-- NULL". Every developer machine and every running demo container has rows
-- here, so the generated form would break all of them.
--
-- The defaults below exist purely to satisfy the ALTER on pre-existing rows.
-- products is fixture data — `pnpm seed` deletes and reinserts every row — so
-- the placeholders are overwritten the first time the catalogue is re-seeded.
ALTER TABLE `products` ADD `pack_label` text DEFAULT '1 pc' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `base_quantity` real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `base_unit` text DEFAULT 'pc' NOT NULL;