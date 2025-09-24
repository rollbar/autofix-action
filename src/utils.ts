export const ISSUE_DESC_START = '=== ISSUE DESCRIPTION START ===';
export const ISSUE_DESC_END = '=== ISSUE DESCRIPTION END ===';

interface TemplatePlaceholders {
  [key: string]: string;
}

export function applyTemplate(template: string, placeholders: TemplatePlaceholders): string {
  let result = template;
  for (const [key, value] of Object.entries(placeholders)) {
    result = result.split(`{{${key}}}`).join(value);
  }
  return result;
}

export function captureLastDelimitedBlock(content: string): string {
  let searchIndex = 0;
  let lastBlock = '';
  while (searchIndex < content.length) {
    const start = content.indexOf(ISSUE_DESC_START, searchIndex);
    if (start === -1) {
      break;
    }
    const blockStart = start + ISSUE_DESC_START.length;
    const end = content.indexOf(ISSUE_DESC_END, blockStart);
    if (end === -1) {
      break;
    }
    lastBlock = content.slice(blockStart, end);
    searchIndex = end + ISSUE_DESC_END.length;
  }

  if (!lastBlock) {
    return '';
  }

  const lines = lastBlock.split(/\r?\n/);
  while (lines.length && lines[0].trim().length === 0) {
    lines.shift();
  }
  while (lines.length && lines[lines.length - 1].trim().length === 0) {
    lines.pop();
  }
  if (lines.length && lines[0].trim() === '### Issue Description') {
    lines.shift();
    while (lines.length && lines[0].trim().length === 0) {
      lines.shift();
    }
  }
  return lines.join('\n');
}

export function removeIssueDescriptionSection(content: string): string {
  const lines = content.split(/\r?\n/);
  const result: string[] = [];
  let skipping = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!skipping && line.trim() === '## Issue Description') {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (line.trim().length === 0) {
        skipping = false;
      }
      continue;
    }
    result.push(line);
  }
  return result.join('\n');
}

export function buildArtifactName(itemCounter: string): string {
  const prefix = 'autofix-';
  const suffix = '-artifacts';
  const MAX_ARTIFACT_NAME_LENGTH = 64;

  const sanitizedCounter = itemCounter
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  const safeCounter = sanitizedCounter.length > 0 ? sanitizedCounter : 'item';

  const maxCounterLength = MAX_ARTIFACT_NAME_LENGTH - (prefix.length + suffix.length);
  const truncatedCounter = maxCounterLength > 0 ? safeCounter.slice(0, maxCounterLength) : safeCounter;
  const finalCounter = truncatedCounter.replace(/^-+|-+$/g, '') || 'item';

  return `${prefix}${finalCounter}${suffix}`;
}
