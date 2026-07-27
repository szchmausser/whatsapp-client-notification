CREATE TABLE `chats` (
	`jid` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_jid` text NOT NULL,
	`message_id` text NOT NULL,
	`sender` text,
	`content` text,
	`message_type` text,
	`timestamp` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`chat_jid`) REFERENCES `chats`(`jid`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_message_id_unique` ON `messages` (`message_id`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`chat_jid` text PRIMARY KEY NOT NULL,
	`last_message_id` text,
	`last_timestamp` integer,
	`last_sync_at` integer,
	FOREIGN KEY (`chat_jid`) REFERENCES `chats`(`jid`) ON UPDATE no action ON DELETE no action
);
