PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `automation_next` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text,
  `directory` text NOT NULL,
  `name` text NOT NULL,
  `prompt` text NOT NULL,
  `schedule` text NOT NULL,
  `status` text NOT NULL,
  `model_provider_id` text,
  `model_id` text,
  `variant` text,
  `next_run_at` integer NOT NULL,
  `last_run_at` integer,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `automation_next` (
  `id`,
  `project_id`,
  `directory`,
  `name`,
  `prompt`,
  `schedule`,
  `status`,
  `next_run_at`,
  `last_run_at`,
  `time_created`,
  `time_updated`
)
SELECT
  `id`,
  `project_id`,
  `directory`,
  `name`,
  `prompt`,
  `schedule`,
  `status`,
  `next_run_at`,
  `last_run_at`,
  `time_created`,
  `time_updated`
FROM `automation`;
--> statement-breakpoint
DROP TABLE `automation`;
--> statement-breakpoint
ALTER TABLE `automation_next` RENAME TO `automation`;
--> statement-breakpoint
CREATE INDEX `automation_project_idx` ON `automation` (`project_id`);
--> statement-breakpoint
CREATE INDEX `automation_directory_idx` ON `automation` (`directory`);
--> statement-breakpoint
CREATE INDEX `automation_due_idx` ON `automation` (`status`, `next_run_at`);
--> statement-breakpoint
ALTER TABLE `automation_run` ADD `directory` text;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
