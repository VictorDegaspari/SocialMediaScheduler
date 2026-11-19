import {z} from 'zod';

export const editorialSchema=z.object({
  enabled:z.boolean().default(true),
  topic:z.string().trim().max(160).default(''),
  keywords:z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  context:z.string().trim().max(2000).default(''),
  ai:z.boolean().default(false),
}).strict();
export type EditorialOptions=z.infer<typeof editorialSchema>;
export function editorialFromDefaults(defaults:unknown){
  return editorialSchema.parse(defaults&&typeof defaults==='object'?(defaults as {editorial?:unknown}).editorial||{}:{});
}
