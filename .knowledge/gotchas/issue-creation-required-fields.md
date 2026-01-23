---
topic: issue-creation-required-fields
tags:
- jira
- issue-creation
- custom-fields
- troubleshooting
files:
- src/tools/issues.ts
- src/index.ts
created: '2026-01-23T14:04:50.039148Z'
updated: '2026-01-23T14:04:50.039148Z'
---

## Overview

When creating JIRA issues, the API may fail with "field is required" errors if required custom fields are not provided.

## Problem

JIRA projects often have required custom fields configured that are not part of the standard issue creation parameters (summary, description, priority, etc.). Attempting to create an issue without these fields results in a 400 error.

## Solution

**Always call `jira_get_create_fields` before `jira_create_issue`** to discover:

1. Which fields are required for the specific project + issue type combination
2. The correct format for each field (via `formatHint`)
3. Allowed values for select/multi-select fields

## Example Workflow

```
1. Call jira_get_create_fields(projectKey="PROJ", issueType="Bug")
2. Review requiredFields array in response
3. Build customFields object with required values
4. Call jira_create_issue with customFields parameter
```

## Custom Field Formats

Different field types require different value formats:

| Schema Type | Format Example |
|-------------|----------------|
| `string` | `"plain text"` |
| `number` | `42` |
| `option` | `{"name": "Value"}` or `{"id": "10001"}` |
| `user` | `{"accountId": "5b10a2844c..."}` |
| `array` of strings | `["value1", "value2"]` |
| `array` of options | `[{"name": "Value1"}, {"name": "Value2"}]` |
| `date` | `"2024-01-15"` |
| `datetime` | `"2024-01-15T10:30:00.000+0000"` |

## Common Pitfalls

1. **Case sensitivity**: Issue type names must match exactly (use `jira_get_create_fields` error message to see available types)
2. **Field ID format**: Custom fields use `customfield_XXXXX` format
3. **Select fields**: Must use `{"value": "..."}` or `{"id": "..."}` format, not plain strings

## Related Files

- src/tools/issues.ts (getCreateFields, createIssue functions)
- src/index.ts (jira_get_create_fields, jira_create_issue tool definitions)