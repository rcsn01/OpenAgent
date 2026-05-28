CREATE TABLE `pi_session_state` (
	`session_id` text PRIMARY KEY NOT NULL,
	`leaf_id` text,
	`metadata` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pi_session_state_leaf_idx` ON `pi_session_state` (`leaf_id`);
--> statement-breakpoint
CREATE TABLE `pi_session_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`parent_id` text,
	`type` text NOT NULL,
	`time_created` integer NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pi_session_entry_session_time_idx` ON `pi_session_entry` (`session_id`,`time_created`,`id`);
--> statement-breakpoint
CREATE INDEX `pi_session_entry_session_parent_idx` ON `pi_session_entry` (`session_id`,`parent_id`);
--> statement-breakpoint
CREATE INDEX `pi_session_entry_session_type_idx` ON `pi_session_entry` (`session_id`,`type`);
