export interface SplitRegion {x:number;y:number;width:number;height:number;}
export interface SplitPane {region:SplitRegion;fit:'fit'|'crop';focusX:number;focusY:number;zoom:number;}
export interface SplitLayout {topRatio:number;webcam:SplitPane;content:SplitPane;}
export interface SplitPaneGeometry {width:number;height:number;crop:SplitRegion;scaled:{width:number;height:number};pad:{x:number;y:number};}
export function defaultSplitLayout():SplitLayout;
export function splitPaneGeometry(sourceWidth:number,sourceHeight:number,width:number,height:number,pane:SplitPane):SplitPaneGeometry;
export function splitLayoutGeometry(sourceWidth:number,sourceHeight:number,width:number,height:number,layout:SplitLayout):{webcam:SplitPaneGeometry;content:SplitPaneGeometry};
