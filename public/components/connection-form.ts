import type {ObjectDirective} from 'vue';

type Field = HTMLInputElement | HTMLSelectElement;
type Value = string | boolean;

function syncField(field: Field, value: Value, preserveDraft: boolean) {
  // Legacy submit handlers read native forms and clear secrets directly on success.
  // Compare against the previous server default, exactly as the existing refresh did.
  if (field instanceof HTMLInputElement && field.type === 'checkbox') {
    const draft = field.checked;
    const edited = preserveDraft && draft !== field.defaultChecked;
    field.defaultChecked = Boolean(value);
    field.checked = edited ? draft : Boolean(value);
    return;
  }
  const draft = field.value;
  const previous = field instanceof HTMLSelectElement
    ? Array.from(field.options).find(option => option.defaultSelected)?.value
    : field.defaultValue;
  const edited = preserveDraft && draft !== previous;
  const next = String(value ?? '');
  if (field instanceof HTMLSelectElement) {
    for (const option of field.options) option.defaultSelected = option.value === next;
  } else field.defaultValue = next;
  const displayed = edited ? draft : next;
  if (field.value !== displayed) field.value = displayed;
}

export const vConnectionValue: ObjectDirective<Field, Value> = {
  mounted(field, binding) {syncField(field, binding.value, false);},
  beforeUpdate(field, binding) {syncField(field, binding.value, true);},
};
