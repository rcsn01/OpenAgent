CREATE TABLE `general_chat` (
	`session_id` text PRIMARY KEY NOT NULL REFERENCES session(id) ON DELETE cascade,
	`directory` text NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE INDEX `general_chat_directory_idx` ON `general_chat` (`directory`);
