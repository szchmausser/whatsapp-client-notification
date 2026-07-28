CREATE TABLE `chats` (
	`jid` varchar(255) NOT NULL,
	`created_at` timestamp NOT NULL,
	CONSTRAINT `chats_jid` PRIMARY KEY(`jid`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`chat_jid` varchar(255) NOT NULL,
	`message_id` varchar(255) NOT NULL,
	`sender` varchar(255),
	`content` text,
	`message_type` varchar(50),
	`timestamp` int NOT NULL,
	`created_at` timestamp NOT NULL,
	`text` text,
	`sender_name` varchar(255),
	`reply_to` varchar(255),
	`is_forwarded` boolean,
	`is_from_me` boolean,
	`mime_type` varchar(100),
	`file_size` int,
	`caption` text,
	`media_url` text,
	`latitude` real,
	`longitude` real,
	`contact_name` varchar(255),
	`contact_phone` varchar(50),
	`file_name` varchar(255),
	`document_url` text,
	`reaction_to` varchar(255),
	`reaction_emoji` varchar(50),
	`forwarding_score` int,
	`is_view_once` boolean,
	`ephemeral_expiration` int,
	`broadcast` boolean,
	`push_name` varchar(255),
	`seconds` int,
	`ptt` boolean,
	`is_animated` boolean,
	`jpeg_thumbnail` text,
	`poll_name` varchar(255),
	`poll_values` text,
	`selectable_count` int,
	`group_jid` varchar(255),
	`group_name` varchar(255),
	`invite_code` varchar(255),
	`invite_expiration` int,
	`selected_button_id` varchar(255),
	`selected_list_option` varchar(255),
	`template_button_selected_id` varchar(255),
	`native_flow_response` text,
	`order_id` varchar(255),
	`order_headline` varchar(255),
	`order_note` text,
	CONSTRAINT `messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `messages_message_id_unique` UNIQUE(`message_id`)
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`chat_jid` varchar(255) NOT NULL,
	`last_message_id` varchar(255),
	`last_timestamp` int,
	`last_sync_at` int,
	CONSTRAINT `sync_state_chat_jid` PRIMARY KEY(`chat_jid`)
);
--> statement-breakpoint
ALTER TABLE `messages` ADD CONSTRAINT `messages_chat_jid_chats_jid_fk` FOREIGN KEY (`chat_jid`) REFERENCES `chats`(`jid`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sync_state` ADD CONSTRAINT `sync_state_chat_jid_chats_jid_fk` FOREIGN KEY (`chat_jid`) REFERENCES `chats`(`jid`) ON DELETE no action ON UPDATE no action;