import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import * as io from '@actions/io';
import {DefaultArtifactClient} from '@actions/artifact';
import {createWriteStream, existsSync} from 'fs';
import {promises as fs} from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  applyTemplate,
  buildArtifactName,
  captureLastDelimitedBlock,
  removeIssueDescriptionSection
} from './utils';

const PR_TITLE_FILENAME = '_pr_title.md';
const PR_BODY_FILENAME = '_pr_body.md';
const SUMMARY_FILENAME = '_autofix_summary.md';

interface Inputs {
  openaiApiKey: string;
  rollbarAccessToken: string;
  githubToken: string | undefined;
  itemCounter: string;
  environment: string;
  language: string;
  testCommand: string;
  lintCommand: string;
  maxIterations: string;
  prBase: string;
}

async function run(): Promise<void> {
  try {
    const inputs = getInputs();
    const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
    const actionPath = process.env.GITHUB_ACTION_PATH ?? path.resolve(__dirname, '..');

    await installCliTools();
    await writeCodexConfig(inputs.rollbarAccessToken, workspace);

    const taskFile = path.join(workspace, '.autofix_task.md');
    const promptTemplatePath = await resolveTemplatePath(
      workspace,
      actionPath,
      'prompt.md'
    );
    const promptTemplate = await fs.readFile(promptTemplatePath, 'utf8');
    const promptContent = applyTemplate(promptTemplate, {
      ITEM_COUNTER: inputs.itemCounter,
      ENVIRONMENT: inputs.environment,
      LANGUAGE: inputs.language,
      TEST_COMMAND: inputs.testCommand,
      LINT_COMMAND: inputs.lintCommand,
      MAX_ITERATIONS: inputs.maxIterations
    });
    await fs.writeFile(taskFile, promptContent, 'utf8');

    const prTemplatePath = await resolveTemplatePath(
      workspace,
      actionPath,
      'pr-template.md'
    );

    const codexLogPath = path.join(workspace, 'codex_exec.log');
    await runCodexExec(inputs, taskFile, codexLogPath, workspace);

    const issueDescription = await extractIssueDescription(codexLogPath, workspace);

    const summaryPath = path.join(workspace, SUMMARY_FILENAME);
    const {title: prTitle, body: prBody} = await preparePullRequestContent(
      workspace,
      prTemplatePath,
      issueDescription,
      inputs,
      summaryPath
    );

    const lintLogPath = path.join(workspace, '_lint.log');
    const testLogPath = path.join(workspace, '_test.log');
    const diffPath = path.join(workspace, '_diff.patch');

    await postRunChecks(
      inputs.lintCommand,
      inputs.testCommand,
      lintLogPath,
      testLogPath,
      diffPath,
      workspace
    );

    let summaryContent = prBody;
    summaryContent = await appendReproScript(summaryPath, workspace, summaryContent);
    await excludeEphemeralFiles(workspace);

    const branchName = await createOrUpdatePullRequest(
      prTitle,
      summaryContent,
      inputs,
      workspace
    );

    await uploadArtifacts(inputs.itemCounter, workspace);
    await cleanup(workspace);

    if (branchName) {
      core.setOutput('branch_name', branchName);
    }
    core.setOutput('pr_title', prTitle);
    core.setOutput('pr_body', summaryContent);
    core.setOutput('summary', summaryContent);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed(String(error));
    }
  }
}

function getInputs(): Inputs {
  const openaiApiKey = core.getInput('openai_api_key', {required: true});
  const rollbarAccessToken = core.getInput('rollbar_access_token', {required: true});
  core.setSecret(rollbarAccessToken);
  core.setSecret(openaiApiKey);
  const githubTokenInput = core.getInput('github_token');

  return {
    openaiApiKey,
    rollbarAccessToken,
    githubToken: githubTokenInput || process.env.GITHUB_TOKEN,
    itemCounter: core.getInput('item_counter', {required: true}),
    environment: core.getInput('environment') || 'unknown',
    language: core.getInput('language') || 'unknown',
    testCommand: core.getInput('test_command') || '',
    lintCommand: core.getInput('lint_command') || '',
    maxIterations: core.getInput('max_iterations') || '1',
    prBase: core.getInput('pr_base') || 'main'
  };
}

async function installCliTools(): Promise<void> {
  core.startGroup('Install Codex CLI and Rollbar MCP');
  await exec.exec('npm', ['install', '-g', '@openai/codex@0.41.0']);
  await exec.exec('npm', ['install', '-g', '@rollbar/mcp-server']);
  core.endGroup();
}

async function writeCodexConfig(rollbarAccessToken: string, workspace: string): Promise<void> {
  core.startGroup('Write Codex configuration');
  const codexDir = path.join(os.homedir(), '.codex');
  await fs.mkdir(codexDir, {recursive: true});
  const configPath = path.join(codexDir, 'config.toml');
  const lines: string[] = [
    '[profiles.ci]',
    'approval-policy = "never"',
    'sandbox_mode = "workspace-write"',
    'model = "gpt-5-codex"',
    'cd = "."',
    '',
    '[mcp_servers.rollbar]',
    'command = "npx"',
    'args = ["-y", "@rollbar/mcp-server"]',
    '',
    '[mcp_servers.rollbar.env]',
    `ROLLBAR_ACCESS_TOKEN = "${rollbarAccessToken}"`
  ];

  const workspacePath = process.env.GITHUB_WORKSPACE ?? workspace;
  if (workspacePath) {
    lines.push('', `[projects."${workspacePath}"]`, 'trust_level = "trusted"');
  }

  await fs.writeFile(configPath, lines.join('\n'), 'utf8');
  core.info('Codex config written to ~/.codex/config.toml (token redacted)');
  core.endGroup();
}

async function resolveTemplatePath(
  workspace: string,
  actionPath: string,
  filename: string
): Promise<string> {
  const overridePath = path.join(
    workspace,
    '.github',
    'rollbar-autofix',
    filename
  );

  try {
    await fs.access(overridePath);
    return overridePath;
  } catch {
    // Fall back to default template below when override is missing.
  }

  const defaultPath = path.join(actionPath, 'templates', filename);
  try {
    await fs.access(defaultPath);
  } catch {
    throw new Error(`Template ${filename} not found at ${defaultPath}`);
  }
  return defaultPath;
}

async function runCodexExec(
  inputs: Inputs,
  taskFile: string,
  logPath: string,
  workspace: string
): Promise<void> {
  const taskContent = await fs.readFile(taskFile, 'utf8');
  const logStream = createWriteStream(logPath, {flags: 'w', encoding: 'utf8'});
  const env = {
    ...process.env,
    OPENAI_API_KEY: inputs.openaiApiKey,
    TASK_FILE: taskFile,
    CI: '1',
    TERM: 'dumb'
  };
  const args = [
    'exec',
    '--profile=ci',
    '--sandbox',
    'workspace-write',
    '-C',
    workspace,
    '--model',
    'gpt-5-codex',
    '--',
    taskContent
  ];

  core.startGroup('Run Codex AutoFix');
  const exitCode = await exec.exec('codex', args, {
    env,
    cwd: workspace,
    ignoreReturnCode: true,
    listeners: {
      stdout: (data: Buffer) => {
        process.stdout.write(data);
        logStream.write(data);
      },
      stderr: (data: Buffer) => {
        process.stderr.write(data);
        logStream.write(data);
      }
    }
  });
  logStream.end();
  core.info(`codex exec exit code: ${exitCode}`);
  if (exitCode !== 0) {
    throw new Error(`codex exec failed with exit code ${exitCode}. See codex_exec.log for details.`);
  }
  core.endGroup();
}

async function extractIssueDescription(
  logPath: string,
  workspace: string
): Promise<string> {
  const issueDescPath = path.join(workspace, '_issue_description.md');
  await fs.writeFile(issueDescPath, '', 'utf8');

  if (!existsSync(logPath)) {
    core.warning('Codex log not found; skipping issue description extraction.');
    return '';
  }

  const logContent = await fs.readFile(logPath, 'utf8');
  const extracted = captureLastDelimitedBlock(logContent);
  await fs.writeFile(issueDescPath, extracted, 'utf8');

  if (extracted) {
    core.info('Extracted issue description section.');
  } else {
    core.info('No delimited issue description found in codex output.');
  }

  return extracted;
}

async function preparePullRequestContent(
  workspace: string,
  prTemplatePath: string,
  issueDescription: string,
  inputs: Inputs,
  summaryPath: string
): Promise<{title: string; body: string}> {
  const titlePath = path.join(workspace, PR_TITLE_FILENAME);
  const bodyPath = path.join(workspace, PR_BODY_FILENAME);

  const titleFromFile = await readOptionalFile(titlePath);
  const bodyFromFile = await readOptionalFile(bodyPath);

  let title = titleFromFile?.trim() ?? '';
  let body = bodyFromFile ?? '';

  let usedFallback = false;

  if (!title) {
    title = `Fix: Rollbar item ${inputs.itemCounter}`;
    usedFallback = true;
  }

  if (!body.trim()) {
    body = await buildSummary(prTemplatePath, summaryPath, issueDescription, inputs);
    usedFallback = true;
  } else {
    await fs.writeFile(summaryPath, body, 'utf8');
  }

  if (!titleFromFile || !titleFromFile.trim()) {
    await fs.writeFile(titlePath, `${title}\n`, 'utf8');
  }

  if (!bodyFromFile || !bodyFromFile.trim()) {
    await fs.writeFile(bodyPath, body, 'utf8');
  }

  if (usedFallback) {
    core.info('PR title/body not provided by agent; using fallback template content.');
  } else {
    core.info('Using PR title/body from agent-generated files.');
  }

  return {title, body};
}

async function readOptionalFile(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (isEnoent(error)) {
      return undefined;
    }
    throw error;
  }
}

function isEnoent(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
async function buildSummary(
  templatePath: string,
  summaryPath: string,
  issueDescription: string,
  inputs: Inputs
): Promise<string> {
  const template = await fs.readFile(templatePath, 'utf8');
  let rendered = applyTemplate(template, {
    ISSUE_DESCRIPTION: issueDescription,
    ITEM_COUNTER: inputs.itemCounter,
    ENVIRONMENT: inputs.environment,
    LANGUAGE: inputs.language,
    TEST_COMMAND: inputs.testCommand,
    LINT_COMMAND: inputs.lintCommand,
    MAX_ITERATIONS: inputs.maxIterations
  });

  if (!issueDescription.trim()) {
    rendered = removeIssueDescriptionSection(rendered);
  }

  await fs.writeFile(summaryPath, rendered, 'utf8');
  return rendered;
}
async function postRunChecks(
  lintCommand: string,
  testCommand: string,
  lintLogPath: string,
  testLogPath: string,
  diffPath: string,
  workspace: string
): Promise<void> {
  core.startGroup('Post-apply lint/test/diff');
  await fs.writeFile(lintLogPath, '', 'utf8');
  await fs.writeFile(testLogPath, '', 'utf8');

  if (lintCommand) {
    const lintStream = createWriteStream(lintLogPath, {flags: 'w'});
    const lintExit = await exec.exec('bash', ['-lc', lintCommand], {
      cwd: workspace,
      ignoreReturnCode: true,
      listeners: {
        stdout: (data: Buffer) => lintStream.write(data),
        stderr: (data: Buffer) => lintStream.write(data)
      }
    });
    lintStream.end();
    core.info(`lint exit code: ${lintExit}`);
  }

  if (testCommand) {
    const testStream = createWriteStream(testLogPath, {flags: 'w'});
    const testExit = await exec.exec('bash', ['-lc', testCommand], {
      cwd: workspace,
      ignoreReturnCode: true,
      listeners: {
        stdout: (data: Buffer) => testStream.write(data),
        stderr: (data: Buffer) => testStream.write(data)
      }
    });
    testStream.end();
    core.info(`test exit code: ${testExit}`);
  }

  const diffResult = await exec.getExecOutput('git', ['diff', '--no-ext-diff'], {
    cwd: workspace,
    ignoreReturnCode: true
  });
  await fs.writeFile(diffPath, diffResult.stdout, 'utf8');
  core.endGroup();
}

async function appendReproScript(
  summaryPath: string,
  workspace: string,
  currentContent: string
): Promise<string> {
  const reproPath = path.join(workspace, 'scripts', 'autofix_repro.sh');
  if (!existsSync(reproPath)) {
    return currentContent;
  }
  const stats = await fs.stat(reproPath);
  if (stats.size === 0) {
    return currentContent;
  }
  const scriptContent = await fs.readFile(reproPath, 'utf8');
  const snippet = `\n## Repro Script\n\n\`\`\`bash\n${scriptContent}\n\`\`\``;
  await fs.appendFile(summaryPath, snippet, 'utf8');
  return `${currentContent}${snippet}`;
}

async function excludeEphemeralFiles(workspace: string): Promise<void> {
  const infoDir = path.join(workspace, '.git', 'info');
  await fs.mkdir(infoDir, {recursive: true});
  const excludePath = path.join(infoDir, 'exclude');
  const entries = [
    '.autofix_task.md',
    SUMMARY_FILENAME,
    '_diff.patch',
    '_issue_description.md',
    '_lint.log',
    '_test.log',
    PR_TITLE_FILENAME,
    PR_BODY_FILENAME,
    'scripts/autofix_repro.sh'
  ];
  const lines = entries.map(entry => `/${entry}`);
  await fs.appendFile(excludePath, `\n${lines.join('\n')}\n`, 'utf8');

  const args = [
    'rm',
    '--cached',
    '-f',
    '--ignore-unmatch',
    '.autofix_task.md',
    SUMMARY_FILENAME,
    '_diff.patch',
    '_issue_description.md',
    '_lint.log',
    '_test.log',
    PR_TITLE_FILENAME,
    PR_BODY_FILENAME,
    'scripts/autofix_repro.sh'
  ];
  await exec.exec('git', args, {cwd: workspace, ignoreReturnCode: true});
}

async function createOrUpdatePullRequest(
  prTitle: string,
  prBody: string,
  inputs: Inputs,
  workspace: string
): Promise<string> {
  const branchName = `autofix/rollbar-item-${inputs.itemCounter}-${process.env.GITHUB_RUN_ID ?? 'manual'}`;
  const commitMessage = `Fix Rollbar item ${inputs.itemCounter}`;
  const token = inputs.githubToken;
  if (!token) {
    throw new Error('A GitHub token is required to create the pull request.');
  }
  core.setSecret(token);

  await configureGitIdentity(workspace);

  await exec.exec('git', ['checkout', '-B', branchName], {cwd: workspace});

  await exec.exec('git', ['add', '--all'], {cwd: workspace});
  const status = await exec.getExecOutput('git', ['status', '--porcelain'], {cwd: workspace});
  if (!status.stdout.trim()) {
    core.info('No changes detected; skipping PR creation.');
    return branchName;
  }

  await exec.exec('git', ['commit', '-m', commitMessage], {cwd: workspace});

  await updateRemoteWithToken(token, workspace);
  await exec.exec('git', ['push', 'origin', `${branchName}:${branchName}`, '--force'], {
    cwd: workspace
  });

  const octokit = github.getOctokit(token);
  const {owner, repo} = github.context.repo;

  const head = `${owner}:${branchName}`;
  const existing = await octokit.rest.pulls.list({
    owner,
    repo,
    state: 'open',
    head
  });

  const prParams = {
    owner,
    repo,
    title: prTitle,
    head: branchName,
    base: inputs.prBase,
    body: prBody,
    draft: true
  };

  if (existing.data.length > 0) {
    const prNumber = existing.data[0].number;
    const {head: _head, draft: _draft, ...updateParams} = prParams;
    void _head;
    void _draft;
    await octokit.rest.pulls.update({
      ...updateParams,
      pull_number: prNumber
    });
    await ensureLabels(octokit, owner, repo, prNumber);
    core.info(`Updated existing pull request #${prNumber}.`);
  } else {
    const created = await octokit.rest.pulls.create(prParams);
    await ensureLabels(octokit, owner, repo, created.data.number);
    core.info(`Created pull request #${created.data.number}.`);
  }

  return branchName;
}

async function configureGitIdentity(workspace: string): Promise<void> {
  await exec.exec('git', ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com'], {
    cwd: workspace
  });
  await exec.exec('git', ['config', 'user.name', 'github-actions[bot]'], {cwd: workspace});
}

async function updateRemoteWithToken(token: string, workspace: string): Promise<void> {
  const {owner, repo} = github.context.repo;
  const remoteUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  await exec.exec('git', ['remote', 'set-url', 'origin', remoteUrl], {
    cwd: workspace,
    silent: true
  });
  core.info('Updated git remote with authentication token.');
}

async function ensureLabels(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<void> {
  await octokit.rest.issues.addLabels({
    owner,
    repo,
    issue_number: issueNumber,
    labels: ['autofix', 'experimental']
  });
}

async function uploadArtifacts(itemCounter: string, workspace: string): Promise<void> {
  core.startGroup('Upload AutoFix artifacts');
  const artifactClient = new DefaultArtifactClient();
  const files = [
    SUMMARY_FILENAME,
    '_issue_description.md',
    '_diff.patch',
    '_lint.log',
    '_test.log',
    'codex_exec.log',
    '_mcp_err.log',
    '_item_raw.json',
    'AUTOFIX_PLAN.md',
    PR_TITLE_FILENAME,
    PR_BODY_FILENAME,
    path.join('scripts', 'autofix_repro.sh')
  ]
    .map(file => path.join(workspace, file))
    .filter(filePath => existsSync(filePath));

  if (files.length === 0) {
    core.info('No artifacts to upload.');
    core.endGroup();
    return;
  }

  const runId = github.context.runId ? String(github.context.runId) : '0';
  const runAttempt = github.context.runAttempt ? String(github.context.runAttempt) : '1';
  const artifactName = buildArtifactName(itemCounter, `${runId}-${runAttempt}`);

  await artifactClient.uploadArtifact(
    artifactName,
    files,
    workspace,
    {
      retentionDays: 7
    }
  );
  core.endGroup();
}

async function cleanup(workspace: string): Promise<void> {
  core.startGroup('Cleanup');
  const pathsToRemove = [
    SUMMARY_FILENAME,
    '_item_raw.json',
    '_mcp_err.log',
    '.autofix_mcp',
    '.mcp.json',
    '.autofix_task.md',
    '_lint.log',
    '_test.log',
    '_diff.patch',
    'codex_exec.log',
    PR_TITLE_FILENAME,
    PR_BODY_FILENAME
  ];

  for (const relPath of pathsToRemove) {
    const target = path.join(workspace, relPath);
    if (existsSync(target)) {
      await io.rmRF(target);
    }
  }
  core.endGroup();
}

void run();
