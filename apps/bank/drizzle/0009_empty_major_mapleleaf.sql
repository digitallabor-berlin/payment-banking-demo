CREATE TABLE `phone_change_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`started_by_user_id` text NOT NULL,
	`approved_by_user_id` text,
	`old_phone` text NOT NULL,
	`new_phone` text NOT NULL,
	`foundry_verification_id` text,
	`state` text DEFAULT 'pending' NOT NULL,
	`failure_reason` text,
	`openid4vp_uri` text,
	`request_uri` text,
	`transport` text DEFAULT 'request_uri' NOT NULL,
	`dc_api_request_json` text,
	`dc_api_protocol` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`started_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
