# Rollbar Autofix

Automatically opens PRs to fix Rollbar errors using Codex and the Rollbar MCP server.

## Usage

Create the following workflow as `.github/workflows/rollbar-autofix.yml`:

```yaml
name: Rollbar Autofix


on:
  repository_dispatch:
    types: [rollbar-autofix]
  workflow_dispatch:
    inputs:
      item_counter:
        description: "Rollbar item counter (e.g., 123456)"
        required: true
        type: string
  pull_request_review:
    types: [submitted]
  issue_comment:
    types: [created]

permissions:
  contents: write

jobs:
  autofix:
    # Only gate PR-review triggered runs; other triggers always run
    if: |
      (github.event_name != 'pull_request_review' && github.event_name != 'issue_comment') ||
      (
        github.event_name == 'pull_request_review' &&
        github.event.action == 'submitted' &&
        github.event.review.state == 'changes_requested' &&
        startsWith(github.event.pull_request.head.ref, 'autofix/rollbar-item-')
      ) || (
        github.event_name == 'issue_comment' &&
        github.event.action == 'created' &&
        github.event.issue.pull_request != null &&
        contains(github.event.comment.body, '/autofix')
      )
    permissions:
      contents: write
      pull-requests: write
      issues: write
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Run AutoFix Agent
        id: autofix
        uses: rollbar/autofix-action@v0.1
        with:
          rollbar_access_token: ${{ secrets.ROLLBAR_AUTOFIX_ACCESS_TOKEN }}
          github_token: ${{ secrets.ROLLBAR_AUTOFIX_GITHUB_TOKEN }}
          openai_api_key: ${{ secrets.OPENAI_API_KEY }}
          item_counter: ${{ inputs.item_counter || github.event.client_payload.item_counter }}
          environment: production
          language: python 3.10, node 16
          test_command: npm test --silent
          lint_command: npm run -s lint
          max_iterations: 2
          pr_base: master
```

## Inputs

- `openai_api_key` (required): API key for Codex.
- `rollbar_access_token` (required): Rollbar project access token (read/write) for MCP tools.
- `github_token` (optional): Token used to open the PR. Use a PAT to allow PR-triggered workflows; omit to use `GITHUB_TOKEN`.
- `item_counter` (required): Rollbar item counter (e.g., `123456`).
- `environment` (optional): Rollbar environment; default `unknown`.
- `language` (optional): Project language hint; default `unknown`.
- `test_command` (optional): Command to run tests.
- `lint_command` (optional): Command to run lints.
- `max_iterations` (optional): Max fix iterations; default `1`.
- `pr_base` (optional): Base branch for PR; default `main`.

## Outputs

- `summary`: Markdown summary of what the agent did.
- `branch_name`: Suggested branch name for the PR.

## Permissions

- Requires `contents: write` and `pull-requests: write`.

## Templates and Overrides

This action bundles Markdown templates for the Codex prompt and PR body and allows host repositories to override them without changing the action code.

Defaults (bundled in this repo):

- `${{ github.action_path }}/templates/prompt.md`
- `${{ github.action_path }}/templates/pr-template.md`

Host-level overrides (optional):

- `.github/rollbar-autofix/prompt.md`
- `.github/rollbar-autofix/pr-template.md`

Placeholders supported in both templates:

- `{{ITEM_COUNTER}}`, `{{ENVIRONMENT}}`, `{{LANGUAGE}}`, `{{TEST_COMMAND}}`, `{{LINT_COMMAND}}`, `{{MAX_ITERATIONS}}`
- In the PR template, `{{ISSUE_DESCRIPTION}}` is replaced with the extracted issue description block produced by Codex.

Note: The prompt template must retain the exact `=== ISSUE DESCRIPTION START ===` / `=== ISSUE DESCRIPTION END ===` markers so the workflow can extract the Issue Description.

## Versioning

Use semver tags and a major alias once published. Recommended usage in workflows: `rollbar/autofix-action@v1`.

## License

MIT

