import {createApp, h, shallowRef} from 'vue';
import ConnectionsPanel from './ConnectionsPanel.vue';
import type {ConnectionsState, ConnectionChannel} from './connection-types.js';

export function mountConnectionsView(root: Element, state: ConnectionsState, channels: ConnectionChannel[]) {
  const snapshot = shallowRef({state, channels});
  const app = createApp({setup: () => () => h('div', {id: 'connections-panel'}, [h(ConnectionsPanel, snapshot.value)])});
  app.mount(root);
  return {
    update(state: ConnectionsState, channels: ConnectionChannel[]) {
      snapshot.value = {state, channels};
    },
    destroy() {app.unmount();},
  };
}
