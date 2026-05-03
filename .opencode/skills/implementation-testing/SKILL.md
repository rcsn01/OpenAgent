---
name: implementation-testing
description: Write unit and end-to-end tests that prove observable behavior without reimplementing production logic in the test.
---

# Implementation Testing

Use this skill when adding or revising unit tests or end-to-end tests.

## Principles

- Test the narrowest seam that proves the behavior you care about.
- Assert on observable results such as returned values, files, state changes, emitted output, or user-visible flow.
- Do not rebuild the same branching or transformation logic inside the test just to compute the expected result.
- Prefer real collaborators and lightweight fixtures over mocks unless isolation is the behavior being tested.
- When fixing a bug, add the regression test at the seam where the bug escaped.

## Unit Tests

- Exercise one public function, service, or boundary at a time.
- Keep fixtures small and purpose-built.
- Verify outcomes, not private implementation steps.

## End-To-End Tests

- Cover the full user or artifact flow across boundaries.
- Assert on the final deliverable or visible behavior.
- Keep happy-path coverage strong before adding edge cases.

## Avoid

- Copying production code into test expectations.
- Mock-heavy tests that only prove mocked interactions.
- Assertions that depend on incidental formatting or internal temporary structure unless that is the contract.
