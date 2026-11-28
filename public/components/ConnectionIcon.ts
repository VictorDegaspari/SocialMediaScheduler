import {defineComponent, h} from 'vue';

const shapes = {
  dashboard: [['rect', {x: '3', y: '3', width: '7', height: '7', rx: '1.5'}], ['rect', {x: '14', y: '3', width: '7', height: '7', rx: '1.5'}], ['rect', {x: '3', y: '14', width: '7', height: '7', rx: '1.5'}], ['rect', {x: '14', y: '14', width: '7', height: '7', rx: '1.5'}]],
  folder: [['path', {d: 'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'}]],
  history: [['path', {d: 'M3 11a9 9 0 1 1 2.8 7M3 4v7h7'}], ['path', {d: 'M12 7v5l3 2'}]],
  link: [['path', {d: 'm10 13 4-4m-6 5-2 2a3 3 0 0 0 4 4l4-4a3 3 0 0 0 0-4M14 10l2-2a3 3 0 0 0-4-4l-4 4a3 3 0 0 0 0 4'}]],
  clock: [['circle', {cx: '12', cy: '12', r: '9'}], ['path', {d: 'M12 7v5l3 2'}]],
  upload: [['path', {d: 'M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5'}]],
  plus: [['path', {d: 'M12 5v14M5 12h14'}]],
  arrow: [['path', {d: 'M4 12h16m-6-6 6 6-6 6'}]],
  pause: [['path', {d: 'M8 5v14M16 5v14'}]],
  play: [['path', {d: 'm8 4 12 8-12 8Z'}]],
  edit: [['path', {d: 'm15 4 5 5M3 21l5-1L21 7a2 2 0 0 0-4-4L4 16Z'}]],
  refresh: [['path', {d: 'M20 7a9 9 0 0 0-15-2L2 8m0-6v6h6m-4 9a9 9 0 0 0 15 2l3-3m0 6v-6h-6'}]],
  check: [['path', {d: 'm5 12 4 4L20 5'}]],
  alert: [['path', {d: 'M12 3 2 21h20L12 3Zm0 6v5m0 3v1'}]],
  monitor: [['rect', {x: '2', y: '3', width: '20', height: '14', rx: '2'}], ['path', {d: 'M8 21h8m-4-4v4'}]],
  youtube: [['rect', {x: '2', y: '5', width: '20', height: '14', rx: '4'}], ['path', {d: 'm10 9 5 3-5 3Z'}]],
  tiktok: [['path', {d: 'M14 3v12a4 4 0 1 1-4-4m4-8c1 4 3 5 6 5'}]],
  drive: [['path', {d: 'm9 3 6 0 8 14-3 5H4l-3-5L9 3Zm0 0 8 14H1m3 5 8-14m5 9h6'}]],
  external: [['path', {d: 'M14 3h7v7m0-7L10 14m0-10H3v17h17v-7'}]],
  moon: [['path', {d: 'M20.8 14A9 9 0 0 1 10 3.2 9 9 0 1 0 20.8 14Z'}]],
  sun: [['circle', {cx: '12', cy: '12', r: '4'}], ['path', {d: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5'}]],
} as const;

export type WorkspaceIconName = keyof typeof shapes;

export default defineComponent((props: {name: WorkspaceIconName}) => {
  return () => h('svg', {
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  }, (shapes[props.name] ?? shapes.folder).map(([tag, attributes]) => h(tag, attributes)));
}, {props: ['name']});
