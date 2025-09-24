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

function sanitizeSegment(segment: string): string {
  return segment
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildArtifactName(itemCounter: string, uniqueSuffix?: string): string {
  const prefix = 'autofix-';
  const suffix = '-artifacts';
  const MAX_ARTIFACT_NAME_LENGTH = 64;

  const safeCounter = sanitizeSegment(itemCounter) || 'item';
  const safeSuffix = uniqueSuffix ? sanitizeSegment(uniqueSuffix) : '';

  const availableLength = MAX_ARTIFACT_NAME_LENGTH - prefix.length - suffix.length;
  if (availableLength <= 0) {
    return `${prefix}item${suffix}`;
  }

  if (!safeSuffix) {
    const counterOnly = safeCounter.slice(0, availableLength).replace(/^-+|-+$/g, '') || 'item';
    return `${prefix}${counterOnly}${suffix}`;
  }

  let suffixPart = safeSuffix;
  if (suffixPart.length > availableLength) {
    suffixPart = suffixPart.slice(-availableLength);
  }

  let counterPart = safeCounter;
  let remaining = availableLength - suffixPart.length;

  if (remaining <= 0) {
    counterPart = '';
  } else {
    const needsHyphen = counterPart.length > 0;
    if (needsHyphen) {
      remaining -= 1;
    }
    if (remaining <= 0) {
      counterPart = '';
    } else if (counterPart.length > remaining) {
      counterPart = counterPart.slice(0, remaining);
    }
  }

  counterPart = counterPart.replace(/^-+|-+$/g, '');
  suffixPart = suffixPart.replace(/^-+|-+$/g, '') || 'run';

  let body = '';
  if (counterPart && suffixPart) {
    body = `${counterPart}-${suffixPart}`;
  } else if (suffixPart) {
    body = suffixPart;
  } else if (counterPart) {
    body = counterPart;
  }

  if (!body) {
    body = 'item';
  }

  if (body.length > availableLength) {
    body = body.slice(-availableLength);
  }

  body = body.replace(/^-+|-+$/g, '') || 'item';

  return `${prefix}${body}${suffix}`;
}
