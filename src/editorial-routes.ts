import {Router} from 'express';
import {z} from 'zod';
import {editorialInputSchema} from './editorial.js';
import {generateEditorialWithAI} from './editorial-ai.js';

const inputSchema=editorialInputSchema.extend({useAI:z.boolean().default(false)});
export const editorialRoutes=Router();
editorialRoutes.post('/api/assistant/metadata/preview',async(req,res)=>{
  const {useAI,...input}=inputSchema.parse(req.body);
  res.json(await generateEditorialWithAI(input,useAI));
});
