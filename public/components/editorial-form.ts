import type {EditorialOptions} from '../../src/editorial-config.js';
import type {EditorialDraft, EditorialInput} from '../../src/editorial.js';

export type EditorialPreviewApi = (
  path: '/assistant/metadata/preview',
  body: Partial<EditorialInput> & {useAI: boolean},
) => Promise<EditorialDraft>;

export function readCommaSeparated(value: FormDataEntryValue | null): string[] {
  return String(value ?? '').split(',').map(part => part.trim()).filter(Boolean);
}

export function readEditorialOptions(fields: FormData, prefix = ''): EditorialOptions {
  return {
    enabled: fields.has(prefix + 'editorialEnabled'),
    ai: fields.has(prefix + 'editorialAi'),
    topic: String(fields.get(prefix + 'editorialTopic') ?? ''),
    context: String(fields.get(prefix + 'editorialContext') ?? ''),
    keywords: readCommaSeparated(fields.get(prefix + 'editorialKeywords')),
  };
}
