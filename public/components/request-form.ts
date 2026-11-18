import type {ObjectDirective} from 'vue';

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type Draft = string | boolean;
type InitialValue = {value: string | number | boolean | undefined; revision?: number};
const drafts = new WeakMap<Field, Draft>();

function applyValue(field: Field, initial: InitialValue, draft?: Draft) {
  if (field instanceof HTMLInputElement && field.type === 'checkbox') {
    field.defaultChecked = Boolean(initial.value);
    field.checked = draft === undefined ? Boolean(initial.value) : Boolean(draft);
    return;
  }
  const value = String(initial.value ?? '');
  if (field instanceof HTMLSelectElement) {
    for (const option of field.options) option.defaultSelected = option.value === value;
    const available = (candidate: string) => Array.from(field.options).some(option => option.value === candidate);
    const next = typeof draft === 'string' && available(draft) ? draft : available(value) ? value : field.options[0]?.value || '';
    if (field.value !== next) field.value = next;
  } else {
    field.defaultValue = value;
    const next = draft === undefined ? value : String(draft);
    if (field.value !== next) field.value = next;
  }
}

// Requests preserve every native form value until that specific form is saved/reset.
// Capture selects before Vue changes their options, then restore only available choices.
export const vRequestValue: ObjectDirective<Field, InitialValue> = {
  mounted(field, binding) {applyValue(field, binding.value);},
  beforeUpdate(field, binding) {
    if (binding.value.revision !== binding.oldValue?.revision) drafts.delete(field);
    else drafts.set(field, field instanceof HTMLInputElement && field.type === 'checkbox' ? field.checked : field.value);
  },
  updated(field, binding) {applyValue(field, binding.value, drafts.get(field)); drafts.delete(field);},
};
