PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`card_id` text,
	`credential_type_id` text DEFAULT 'com.emvco.dpc.card' NOT NULL,
	`credential_id` text,
	`foundry_tx_id` text,
	`state` text NOT NULL,
	`issued_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
-- credential_type_id is DELIBERATELY absent from both lists. drizzle-kit
-- generated it on both sides, but the OLD credentials table has no such
-- column, so the generated statement failed with `no such column:
-- "credential_type_id"` and made the whole migration unrunnable. Omitting it
-- here is what lets the column DEFAULT backfill every existing row as a
-- payment credential -- which is the behaviour schema.test.ts asserts.
INSERT INTO `__new_credentials`("id", "user_id", "card_id", "credential_id", "foundry_tx_id", "state", "issued_at", "created_at") SELECT "id", "user_id", "card_id", "credential_id", "foundry_tx_id", "state", "issued_at", "created_at" FROM `credentials`;--> statement-breakpoint
DROP TABLE `credentials`;--> statement-breakpoint
ALTER TABLE `__new_credentials` RENAME TO `credentials`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `credentials_credential_id_unique` ON `credentials` (`credential_id`);