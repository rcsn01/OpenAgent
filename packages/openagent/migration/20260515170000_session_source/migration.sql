ALTER TABLE `session` ADD `source` text NOT NULL DEFAULT 'user';
--> statement-breakpoint
UPDATE `session`
SET `source` = 'automation'
WHERE `id` IN (
  SELECT `session_id`
  FROM `automation_run`
  WHERE `session_id` IS NOT NULL
)
OR `title` LIKE '[Automation] %';
