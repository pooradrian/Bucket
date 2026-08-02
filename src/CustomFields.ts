import type {Character} from './CharacterEditor';

export interface CustomFieldDefinition {
  id: string;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  lines?: number;
}

export interface CustomFieldValue {
  id: string;
  value: string;
}

export const CUSTOM_FIELDS: CustomFieldDefinition[] = [
  {
    id: 'writingStyle',
    label: 'Writing Style',
    placeholder: 'How do they write? Formal, casual, verbose, terse, poetic...',
    multiline: true,
    lines: 4,
  },
];

export function getCustomField(character: Character, fieldId: string): string {
  return character.customFields?.find(f => f.id === fieldId)?.value ?? '';
}

export function hasCustomFields(character: Character): boolean {
  return (character.customFields || []).some(f => f.value.trim().length > 0);
}

export function parseCustomFields(raw: string | null | undefined): CustomFieldValue[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
