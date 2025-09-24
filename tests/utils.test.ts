import {describe, expect, it} from 'vitest';
import {
  applyTemplate,
  buildArtifactName,
  captureLastDelimitedBlock,
  removeIssueDescriptionSection
} from '../src/utils';

describe('applyTemplate', () => {
  it('replaces all placeholders in a template', () => {
    const template = 'Hello {{NAME}}! Welcome to {{PLACE}}.';
    const result = applyTemplate(template, {NAME: 'Codex', PLACE: 'GitHub'});
    expect(result).toBe('Hello Codex! Welcome to GitHub.');
  });
});

describe('captureLastDelimitedBlock', () => {
  it('extracts the last block between delimiters and trims whitespace', () => {
    const content = [
      'log output',
      '=== ISSUE DESCRIPTION START ===',
      '',
      '### Issue Description',
      'First block',
      '=== ISSUE DESCRIPTION END ===',
      'more logs',
      '=== ISSUE DESCRIPTION START ===',
      '',
      '### Issue Description',
      '',
      'Final details',
      '',
      '=== ISSUE DESCRIPTION END ==='
    ].join('\n');

    expect(captureLastDelimitedBlock(content)).toBe('Final details');
  });

  it('returns empty string when delimiters are missing', () => {
    expect(captureLastDelimitedBlock('no markers here')).toBe('');
  });
});

describe('removeIssueDescriptionSection', () => {
  it('removes the issue description section from rendered content', () => {
    const content = [
      '# Summary',
      '',
      '## Issue Description',
      'Details go here',
      '',
      '## Next Steps'
    ].join('\n');

    expect(removeIssueDescriptionSection(content)).toBe(['# Summary', '', '## Next Steps'].join('\n'));
  });
});

describe('buildArtifactName', () => {
  it('sanitizes and truncates the item counter to fit within limits', () => {
    const longCounter = 'problematic counter! with spaces and symbols @@@ longer than allowed length';
    const name = buildArtifactName(longCounter);

    expect(name.startsWith('autofix-')).toBe(true);
    expect(name.endsWith('-artifacts')).toBe(true);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name).not.toContain(' ');
  });

  it('appends a unique suffix when provided', () => {
    const name = buildArtifactName('item-123', '987654321-2');

    expect(name).toBe('autofix-item-123-987654321-2-artifacts');
  });

  it('preserves uniqueness even when the suffix must be truncated', () => {
    const longSuffix = 'run-' + 'x'.repeat(100) + '-42';
    const name = buildArtifactName('counter', longSuffix);

    expect(name.startsWith('autofix-')).toBe(true);
    expect(name.endsWith('-artifacts')).toBe(true);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name).toMatch(/x-42-artifacts$/);
  });
});
