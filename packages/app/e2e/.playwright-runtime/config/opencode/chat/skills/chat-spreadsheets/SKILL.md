---
name: chat-spreadsheets
description: Create workbook specs for GUI chats by writing structured JSON that is ready for export or handoff.
---

# Chat Spreadsheets

Use this skill when the user wants an Excel workbook, tracker, table export, model input sheet, or lightweight analysis handoff.

## Workflow

1. Decide the workbook structure and sheet names.
2. Draft a workbook-spec JSON file in the hidden chat workspace.
3. Keep the JSON source next to related deliverables so it can be regenerated.
4. If spreadsheet-export tooling is available in the session, export the workbook. Otherwise leave a clean workbook spec that is ready for export.

## Suggested JSON Shape

```json
{
  "sheets": [
    {
      "name": "Tasks",
      "columns": [
        { "header": "Task", "key": "task", "width": 28 },
        { "header": "Owner", "key": "owner", "width": 18 },
        { "header": "Status", "key": "status", "width": 16 }
      ],
      "rows": [
        { "task": "Draft launch plan", "owner": "Avery", "status": "Done" },
        { "task": "Review metrics", "owner": "Sam", "status": "In Progress" }
      ]
    }
  ]
}
```

## Suggested Filenames

- Source spec: `deliverables/<topic>-workbook.json`
- Optional export target: `deliverables/<topic>.xlsx`
