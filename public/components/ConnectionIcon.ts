import {createStaticVNode, defineComponent} from 'vue';
import type {ConnectionIconName, IconRenderer} from './connection-types.js';

// Only fixed icon names use the existing trusted SVG helper; account data uses templates.
export default defineComponent((props: {name: ConnectionIconName; icon: IconRenderer}) => {
  return () => createStaticVNode(props.icon(props.name), 1);
}, {props: ['name', 'icon']});
