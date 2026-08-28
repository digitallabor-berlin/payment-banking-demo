CREATE TABLE `verifier_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tx_id` text NOT NULL,
	`event` text NOT NULL,
	`transport` text,
	`signed_request` text,
	`vp_token_json` text,
	`received_at` integer NOT NULL
);
