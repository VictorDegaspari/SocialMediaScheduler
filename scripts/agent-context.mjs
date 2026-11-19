import ts from 'typescript';
import {parse as parseVue} from 'vue/compiler-sfc';
import {readFile,realpath,readdir} from 'node:fs/promises';
import {resolve,relative,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const maxOutput=32_000,defaultOutput=6_000;
const codeExtensions=new Set(['.ts','.js','.mjs','.vue']);
const rootFiles=new Set(['AGENTS.md','README.md','package.json','tsconfig.json','tsconfig.frontend.json','vite.config.ts','compose.yaml','Dockerfile','.gitignore','.dockerignore','requirements-cuts.txt']);
const sourceRoots=new Set(['src','public','scripts','tests','docs','website']);
const textExtensions=new Set(['.ts','.js','.mjs','.vue','.json','.md','.css','.html','.svg','.sh','.py','.yaml','.yml','.txt']);
const help='ctx map [area] | outline file[#symbol] [--match=text] | show file[#symbol] | checks area | check\nOutput cap: --max-chars=6000 (max 32000). AST inspection never imports application code.';

export function indexSource(text,filename){
  let script=text;
  if(extname(filename)==='.vue'){
    // Mask markup without moving the script's source offsets or line numbers.
    script=text.replace(/[^\r\n]/g,' ');
    const {descriptor}=parseVue(text,{filename});
    for(const block of [descriptor.script,descriptor.scriptSetup].filter(Boolean)){
      const start=block.loc.start.offset;
      script=script.slice(0,start)+block.content+script.slice(start+block.content.length);
    }
  }
  const source=ts.createSourceFile(filename,script,ts.ScriptTarget.Latest,true,extname(filename)==='.vue'?ts.ScriptKind.TS:undefined),symbols=[];
  function visit(node,parent=null){
    let name;
    if(ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node)||ts.isInterfaceDeclaration(node)||ts.isTypeAliasDeclaration(node)||ts.isEnumDeclaration(node))name=node.name?.getText(source)||'default';
    else if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name))name=node.name.text;
    else if(ts.isMethodDeclaration(node)||ts.isConstructorDeclaration(node)||ts.isGetAccessorDeclaration(node)||ts.isSetAccessorDeclaration(node))name=node.name?.getText(source)||'constructor';
    else if(ts.isPropertyAssignment(node)&&(ts.isArrowFunction(node.initializer)||ts.isFunctionExpression(node.initializer)))name=node.name.getText(source);
    else if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.arguments.some(arg=>ts.isArrowFunction(arg)||ts.isFunctionExpression(arg))){
      const method=node.expression.name.text,arg=node.arguments[0];
      if(arg&&(ts.isStringLiteralLike(arg)||ts.isTemplateExpression(arg))){
        const value=ts.isStringLiteralLike(arg)?arg.text:arg.getText(source).slice(1,-1);
        if(['get','post','put','patch','delete'].includes(method))name=method.toUpperCase()+' '+value;
        else if(method==='addEventListener')name='on '+node.expression.expression.getText(source)+'.'+value;
      }
    }
    let owner=parent;
    if(name){
      const start=node.getStart(source,true),end=node.getEnd(),parentName=parent===null?'':symbols[parent].name+'.';
      owner=symbols.length;
      const location=source.getLineAndCharacterOfPosition(start);
      symbols.push({name:parentName+name,label:name,parent,start,end,line:location.line+1,column:location.character+1,endLine:source.getLineAndCharacterOfPosition(end).line+1,kind:ts.SyntaxKind[node.kind]});
    }
    ts.forEachChild(node,child=>visit(child,owner));
  }
  visit(source);
  const counts=new Map();for(const symbol of symbols)counts.set(symbol.name,(counts.get(symbol.name)||0)+1);
  for(const symbol of symbols)if(counts.get(symbol.name)>1)symbol.name+='@'+symbol.line+':'+symbol.column;
  return {symbols,imports:source.statements.filter(ts.isImportDeclaration).map(node=>node.moduleSpecifier.text)};
}

function findSymbol(index,name){
  const symbol=index.symbols.find(item=>item.name===name);
  if(!symbol)throw new Error(`Unknown symbol: ${name}. Use outline, optionally --match=${name.split('.').at(-1)}.`);
  return symbol;
}

export function selectSource(text,filename,name){
  const index=indexSource(text,filename),symbol=findSymbol(index,name);
  return {...symbol,text:text.slice(symbol.start,symbol.end)};
}

export function outlineSource(text,filename,{selector,match}={}){
  const index=indexSource(text,filename),owner=selector?findSymbol(index,selector):null;
  const parent=owner?index.symbols.indexOf(owner):null;
  const symbols=index.symbols.filter(symbol=>match?(!owner||symbol.start>owner.start&&symbol.end<=owner.end)&&(symbol.label.toLowerCase().includes(match.toLowerCase())||symbol.name===match):symbol.parent===parent);
  return {imports:owner||match?[]:index.imports,symbols};
}

export async function readProjectFile(path){
  const requested=resolve(root,path),local=relative(root,requested),parts=local.split(sep);
  if(local.startsWith('..')||!local||!sourceRoots.has(parts[0])&&!rootFiles.has(local))throw new Error('Only project source/configuration files are available.');
  if(parts.some(part=>part.startsWith('.')&&!rootFiles.has(local))||parts.some(part=>['node_modules','dist','data','media','artifacts'].includes(part)))throw new Error('Generated/private paths are excluded.');
  if(!rootFiles.has(local)&&local!=='scripts/ctx'&&!textExtensions.has(extname(local)))throw new Error('Only text source/configuration files are available.');
  const actual=await realpath(requested);
  if(actual!==requested)throw new Error('Symlink paths are excluded.');
  return {path:local.replaceAll(sep,'/'),text:await readFile(actual,'utf8')};
}

export function bounded(text,budget=defaultOutput){
  if(!Number.isInteger(budget)||budget<200||budget>maxOutput)throw new Error(`--max-chars must be 200..${maxOutput}.`);
  if(text.length>budget)throw new Error(`Selection is ${text.length} characters; cap is ${budget}. Narrow with outline/#symbol/--match before raising --max-chars. Nothing was truncated.`);
  return text;
}

async function manifest(){return JSON.parse((await readProjectFile('scripts/context-map.json')).text);}
function areaOf(areas,name){if(!Object.hasOwn(areas,name))throw new Error('Unknown area. Use ctx map.');return areas[name];}

export function checkCommands(area){
  const commands=['./scripts/node-local.sh node_modules/typescript/bin/tsc --noEmit'];
  if(area.ui.length)commands.push('./scripts/node-local.sh node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p tsconfig.frontend.json','./scripts/node-local.sh node_modules/vite/bin/vite.js build');
  if(area.unit.length)commands.push('./scripts/node-local.sh --test '+area.unit.join(' '));
  if(area.integration.length)commands.push('./scripts/test-integration.sh '+area.integration.join(' '));
  const fullUi=area.ui.includes('scripts/check-ui.mjs');
  if(fullUi)commands.push('./scripts/test-ui.sh # includes QA setup/cleanup');
  else for(const script of area.ui)commands.push('./scripts/node-local.sh '+script);
  if(area.browser?.length)commands.push('# Browser fixtures: inspect '+area.browser.join(' ')+' before running.');
  return commands.join('\n');
}

async function checkManifest(areas){
  const files=new Set();
  for(const [name,area] of Object.entries(areas)){
    for(const dep of area.depends)areaOf(areas,dep);
    for(const key of ['code','unit','integration','ui','browser','docs'])for(const path of area[key]||[]){await readProjectFile(path);files.add(path);}
    if(!area.code.length)throw new Error('Empty code area: '+name);
  }
  async function walk(dir){
    for(const entry of await readdir(resolve(root,dir),{withFileTypes:true})){
      const path=dir+'/'+entry.name;
      if(entry.isDirectory()&&!entry.name.startsWith('.')&&path!=='public/build')await walk(path);
      else if(entry.isFile()&&codeExtensions.has(extname(entry.name))&&!files.has(path))throw new Error('Unmapped source: '+path);
    }
  }
  for(const dir of ['src','public'])await walk(dir);
  return `OK ${Object.keys(areas).length} areas, ${files.size} referenced files; src/public modules covered.`;
}

export async function run(args){
  const flags={},positionals=[];
  for(const arg of args){
    if(arg.startsWith('--')){
      const option=arg.match(/^--(max-chars|match)=(.+)$/);if(!option||Object.hasOwn(flags,option[1]))throw new Error(help);
      flags[option[1]]=option[2];
    }else positionals.push(arg);
  }
  const [command='map',target,...extra]=positionals,budget=flags['max-chars']===undefined?defaultOutput:Number(flags['max-chars']);
  if(extra.length)throw new Error(help);
  let output;
  if(['map','checks','check'].includes(command)){
    const areas=await manifest();
    if(command==='check'){if(target)throw new Error(help);output=await checkManifest(areas);}
    else if(command==='checks'){if(!target)throw new Error(help);output=checkCommands(areaOf(areas,target));}
    else if(!target)output=Object.entries(areas).map(([name,area])=>`${name}: ${area.code[0]} (${area.code.length} files; unit ${area.unit.length}, integration ${area.integration.length}, UI ${area.ui.length})`).join('\n');
    else output=Object.entries(areaOf(areas,target)).filter(([,value])=>value.length).map(([key,value])=>key+': '+value.join(' ')).join('\n');
  }else if(['outline','show'].includes(command)){
    if(!target)throw new Error(help);
    const [path,selector,...more]=target.split('#');if(more.length)throw new Error(help);
    const file=await readProjectFile(path);
    if(command==='show'){
      const selection=selector?selectSource(file.text,file.path,selector):{text:file.text,line:1};
      output=`${file.path}:${selection.line}${selector?' #'+selector:''}\n${selection.text}`;
    }else{
      if(!codeExtensions.has(extname(file.path)))throw new Error('Outline supports TS/JS/MJS/Vue script; use show for other source files.');
      const outline=outlineSource(file.text,file.path,{selector,match:flags.match});
      output=[file.path+(selector?' #'+selector:''),...(outline.imports.length?['imports: '+outline.imports.join(' ')]:[]),...outline.symbols.map(item=>`${item.name} L${item.line}-${item.endLine} ${item.end-item.start}ch`)].join('\n');
    }
  }else throw new Error(help);
  return bounded(output,budget);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.stdout.write(await run(process.argv.slice(2))+'\n');}
  catch(error){process.stderr.write(error.message+'\n');process.exitCode=2;}
}
