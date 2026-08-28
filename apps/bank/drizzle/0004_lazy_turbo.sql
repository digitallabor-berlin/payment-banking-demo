CREATE TABLE `transaction_proofs` (
	`transaction_id` text PRIMARY KEY NOT NULL,
	`signed_request` text NOT NULL,
	`vp_token_json` text NOT NULL,
	`received_at` integer NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
