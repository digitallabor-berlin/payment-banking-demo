CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`total_cents` integer NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`customer_name` text NOT NULL,
	`customer_email` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payment_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`foundry_verification_id` text,
	`state` text DEFAULT 'pending' NOT NULL,
	`openid4vp_uri` text,
	`request_uri` text,
	`disclosed_claims_json` text,
	`checks_json` text,
	`bank_tx_id` text,
	`failure_reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`price_cents` integer NOT NULL,
	`image_url` text NOT NULL,
	`category` text NOT NULL
);
