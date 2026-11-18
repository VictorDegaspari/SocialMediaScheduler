type Output={width:number;height:number};
type Placement={x:number;y:number;width:number};
export function overlayVisible(overlay:{start:number;end:number|null},time:number,duration:number):boolean;
export function wrapOverlayText(text:string,fontSize:number,width:number):string[];
export function overlayTextLayout(overlay:{text:string;fontSize:number;width:number},output:Output):{lines:string[];fontSize:number;lineHeight:number};
export function overlayImageBox(overlay:Placement,output:Output,image:Output):Output&{x:number;y:number};
