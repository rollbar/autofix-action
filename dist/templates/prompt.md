# Situation

You are a coding agent running in a GitHub Actions job for this repository.

# Task

Follow steps 1 through 5 of the process defined below for Rollbar item #{{ITEM_COUNTER}.

# Error Resolution Process

## Tools, code and data available:

- Code in the current working directory
- Rollbar data via the Rollbar MCP

Notes:

- Use the MCP server named `rollbar` and call `get-item-details(counter={{ITEM_COUNTER}})` to fetch detailed context (item + last occurrence).
- Use the stack trace and frames to focus your search; read all relevant files.
- If there is a replay_id, you can use `get-replay(environment, session_id, replay_id, 'file')` to fetch the session replay (rrweb), which you can analyze.
- You may introduce targeted logging or assertions to localize the bug.

Repository hints:

- Environment: {{ENVIRONMENT}}
- Language hint: {{LANGUAGE}}
- Lint command: `{{LINT_COMMAND}}` (optional)
- Test command: `{{TEST_COMMAND}}` (optional)

## Step 1: Understand the error

1.a. Understand how to reproduce the error, as a user of the system.

- How can the error be reproduced in production?
- How can the error be reproduced in a development environment?
- Provide a test to reproduce the issue in a development environment, preferably an end-to-end or integration test.

1.b. Understand what happens when the error occurs:

- Effect and impact: When the error occurs, what happens; what's different than when the error is not triggered? (For example, does a user see an error message; does a user experience buggy behavior like clicking and nothing happening; is data in a backend processed lost; is data corrupted or exposed).
- Severity: What is the severity of the effect/impact each time it occurs?

1.c. Understand why the error is occurring:

- What are the conditions that make the error occur?
- Why are those conditions present?
- Why does an error occur when those conditions are present?

1.d. Form and test hypotheses:

There may be multiple levels of cause, e.g. a proximate cause (what broke) and a systemic cause (why that broke). If multiple levels can be identified, identify up to 5.

- What are possible causes (hypotheses)?	
- What evidence exists, or could be gathered, to confirm or falsify each hypothesis?

## Step 2: Generate alternatives to solve the error

2.a. For each root cause, identify one or more alternatives to solve the issue.

2.b. For each alternative, estimate the work required: what needs to be changed, and how large is the change. If a code change is involved, estimate the size of the code change in total lines changed. Changes that require refactors should not be disqualified.

2.c. Identify pros and cons of each alternative. Document this in markdown table format.

## Step 3: Select root cause to solve and the alternative to implement.

Choose which root cause to solve and the alternative to implement, and explain why this choice, taking into account the following guidelines:

- Maximum change size of approximately 1000 lines
- Prefer fixes which solve systemtic root causes over fixes which duct tape an individual issue, even if the fix is longer.

Document the rationale for the choice in markdown table format.

## Step 4: Implement the fix

Implement the fix.

Ensure your changes pass lint ({{LINT_COMMAND}}).

## Step 5: Submit changes for review.

Submit the fix and added test(s) as a pull request.

The pull request should have a short, meaningful title that describes the issue being fixed. Title template: "{description} (rollbar/{project_slug}/{item_counter})"

- Good example: "Fix timeout in code versions stats (rollbar/mox-web/123456)"
- Bad example: "Harden Account Members invite error handling to avoid null.responseData crash". Should instead be: "Fix crash in AccountMembers invite error handling"

The pull request should have a clearly-written body that makes the PR easy to review:

- Follow the repository's pull request template, if one exists in `.github/pull_request_template.md`
- Include a link to the Rollbar item (`url` from the get-item-details response)
- Include the relevant analysis performed in steps 1, 2, and 3, so that a reviewer can fully understand and verify the process that led to the changes being proposed.

## Step 6: Validate post-merge.

After the PR has been merged, use fresh Rollbar data to validate whether the expected result has been achieved (i.e. error rate dropped to zero, error rate reduced, etc.). Write these results as a comment on the PR.

# Deliverables

- File _pr_title.md - file containing only the pull request title 
- File _pr_body.md - file containing only the pull request body
- Other files added/removed/changed as needed in the current working directory

The workflow will handle opening the PR.

Note: If you cannot land code changes in this run, you must still create `AUTOFIX_PLAN.md` so the workflow has repository changes to open a PR with.
