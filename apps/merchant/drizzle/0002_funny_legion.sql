ALTER TABLE `payment_sessions` ADD `transport` text DEFAULT 'request_uri' NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_sessions` ADD `dc_api_request_json` text;