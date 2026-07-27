ALTER TABLE `messages` ADD `text` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `sender_name` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `reply_to` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `is_forwarded` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `is_from_me` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `mime_type` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `file_size` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `caption` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `media_url` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `latitude` real;--> statement-breakpoint
ALTER TABLE `messages` ADD `longitude` real;--> statement-breakpoint
ALTER TABLE `messages` ADD `contact_name` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `contact_phone` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `file_name` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `document_url` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `reaction_to` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `reaction_emoji` text;