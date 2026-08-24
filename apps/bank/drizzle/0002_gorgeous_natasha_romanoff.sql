CREATE TABLE `login_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`foundry_verification_id` text,
	`state` text DEFAULT 'pending' NOT NULL,
	`openid4vp_uri` text,
	`request_uri` text,
	`transport` text DEFAULT 'request_uri' NOT NULL,
	`dc_api_request_json` text,
	`user_id` text,
	`failure_reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
