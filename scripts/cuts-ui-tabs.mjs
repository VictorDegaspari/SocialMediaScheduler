// Follow the visible tab controls instead of rebuilding or exposing hidden fields.
export async function revealEditorControl(page,target){
  const locator=typeof target==='string'?page.locator(target).first():target;
  const tabs=await locator.evaluate(element=>{
    const ids=[];
    for(let node=element;node&&node.id!=='cuts-dialog-form';node=node.parentElement)if(node.matches('[data-editor-panel]'))ids.unshift(node.getAttribute('aria-labelledby'));
    return ids;
  });
  for(const id of tabs){const tab=page.locator('#'+id);if(await tab.getAttribute('aria-selected')!=='true')await tab.click();}
  return locator;
}
