import { describe, it, expect } from 'vitest';
import { adfToText, extractParent } from '../issues.js';

describe('adfToText', () => {
  it('returns empty string for undefined', () => {
    expect(adfToText(undefined)).toBe('');
  });

  it('returns empty string for null', () => {
    expect(adfToText(null as unknown as undefined)).toBe('');
  });

  it('returns string as-is', () => {
    expect(adfToText('plain text')).toBe('plain text');
  });

  it('extracts text from simple paragraph', () => {
    const doc = {
      type: 'doc' as const,
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello world' }],
        },
      ],
    };
    expect(adfToText(doc)).toBe('Hello world');
  });

  it('extracts text from multiple paragraphs', () => {
    const doc = {
      type: 'doc' as const,
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'First' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Second' }],
        },
      ],
    };
    expect(adfToText(doc)).toBe('FirstSecond');
  });

  it('handles nested content', () => {
    const doc = {
      type: 'doc' as const,
      version: 1,
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Item 1' }],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Item 2' }],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(adfToText(doc)).toBe('Item 1Item 2');
  });

  it('converts hardBreak to newline', () => {
    const doc = {
      type: 'doc' as const,
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Line 1' },
            { type: 'hardBreak' },
            { type: 'text', text: 'Line 2' },
          ],
        },
      ],
    };
    expect(adfToText(doc)).toBe('Line 1\nLine 2');
  });

  it('handles empty content array', () => {
    const doc = {
      type: 'doc' as const,
      version: 1,
      content: [],
    };
    expect(adfToText(doc)).toBe('');
  });
});

describe('extractParent', () => {
  it('returns undefined for empty fields', () => {
    expect(extractParent({})).toBeUndefined();
  });

  it('extracts next-gen parent with full info', () => {
    const fields = {
      parent: {
        key: 'PROJ-100',
        fields: {
          summary: 'Epic title',
          issuetype: { name: 'Epic' },
        },
      },
    };
    expect(extractParent(fields)).toEqual({
      key: 'PROJ-100',
      summary: 'Epic title',
      type: 'Epic',
    });
  });

  it('handles next-gen parent with missing summary', () => {
    const fields = {
      parent: {
        key: 'PROJ-100',
        fields: {},
      },
    };
    expect(extractParent(fields)).toEqual({
      key: 'PROJ-100',
      summary: '',
      type: 'Unknown',
    });
  });

  it('handles next-gen parent with missing fields', () => {
    const fields = {
      parent: {
        key: 'PROJ-100',
      },
    };
    expect(extractParent(fields)).toEqual({
      key: 'PROJ-100',
      summary: '',
      type: 'Unknown',
    });
  });

  it('returns undefined for parent without key', () => {
    const fields = {
      parent: {
        fields: { summary: 'No key' },
      },
    };
    expect(extractParent(fields)).toBeUndefined();
  });

  it('extracts classic epic link from customfield', () => {
    const fields = {
      customfield_10014: 'PROJ-50',
    };
    expect(extractParent(fields)).toEqual({
      key: 'PROJ-50',
      summary: '',
      type: 'Epic',
    });
  });

  it('ignores non-issue-key customfield values', () => {
    const fields = {
      customfield_10014: 'not an issue key',
      customfield_10015: 12345,
      customfield_10016: null,
    };
    expect(extractParent(fields)).toBeUndefined();
  });

  it('prefers next-gen parent over classic epic link', () => {
    const fields = {
      parent: {
        key: 'PROJ-100',
        fields: {
          summary: 'Next-gen parent',
          issuetype: { name: 'Story' },
        },
      },
      customfield_10014: 'PROJ-50',
    };
    expect(extractParent(fields)).toEqual({
      key: 'PROJ-100',
      summary: 'Next-gen parent',
      type: 'Story',
    });
  });
});
