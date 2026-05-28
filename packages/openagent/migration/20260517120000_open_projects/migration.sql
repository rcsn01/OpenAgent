CREATE TABLE `project_open` (
	`directory` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `project_open_project_idx` ON `project_open` (`project_id`);

INSERT OR IGNORE INTO `project_open` (`directory`, `project_id`, `time_created`, `time_updated`)
SELECT
	`worktree`,
	`id`,
	`time_created`,
	`time_updated`
FROM `project`
WHERE `id` != 'global' AND `worktree` IS NOT NULL AND `worktree` != '';

INSERT OR IGNORE INTO `project_open` (`directory`, `project_id`, `time_created`, `time_updated`)
SELECT
	`session`.`directory`,
	`session`.`project_id`,
	MIN(`session`.`time_created`),
	MAX(`session`.`time_updated`)
FROM `session`
INNER JOIN `project` ON `project`.`id` = `session`.`project_id`
WHERE `session`.`directory` IS NOT NULL AND `session`.`directory` != ''
	AND `session`.`directory` NOT LIKE '%/opencode/chats/%'
	AND `session`.`directory` NOT LIKE '%/opencode/worktree/%'
GROUP BY `session`.`directory`, `session`.`project_id`;

INSERT OR IGNORE INTO `project_open` (`directory`, `project_id`, `time_created`, `time_updated`)
SELECT
	`automation`.`directory`,
	`automation`.`project_id`,
	MIN(`automation`.`time_created`),
	MAX(`automation`.`time_updated`)
FROM `automation`
INNER JOIN `project` ON `project`.`id` = `automation`.`project_id`
WHERE `automation`.`project_id` IS NOT NULL
	AND `automation`.`directory` IS NOT NULL
	AND `automation`.`directory` != ''
GROUP BY `automation`.`directory`, `automation`.`project_id`;
