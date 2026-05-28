CREATE TABLE `automation` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `directory` text NOT NULL,
  `name` text NOT NULL,
  `prompt` text NOT NULL,
  `schedule` text NOT NULL,
  `status` text NOT NULL,
  `next_run_at` integer NOT NULL,
  `last_run_at` integer,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `automation_project_idx` ON `automation` (`project_id`);
--> statement-breakpoint
CREATE INDEX `automation_directory_idx` ON `automation` (`directory`);
--> statement-breakpoint
CREATE INDEX `automation_due_idx` ON `automation` (`status`, `next_run_at`);
--> statement-breakpoint
CREATE TABLE `automation_run` (
  `id` text PRIMARY KEY NOT NULL,
  `automation_id` text NOT NULL,
  `session_id` text,
  `status` text NOT NULL,
  `error` text,
  `started_at` integer NOT NULL,
  `completed_at` integer,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  FOREIGN KEY (`automation_id`) REFERENCES `automation`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `automation_run_automation_idx` ON `automation_run` (`automation_id`);
--> statement-breakpoint
CREATE INDEX `automation_run_status_idx` ON `automation_run` (`status`);
