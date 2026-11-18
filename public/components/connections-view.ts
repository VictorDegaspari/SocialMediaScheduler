import {createApp, h, shallowRef} from 'vue';
import ConnectionsPanel from './ConnectionsPanel.vue';
import type {ConnectionsState, ConnectionChannel, IconRenderer} from './connection-types.js';

export function mountConnectionsView(root: Element, state: ConnectionsState, channels: ConnectionChannel[], icon: IconRenderer) {
  const snapshot = shallowRef({state, channels, icon});
  const app = createApp({setup: () => () => h(ConnectionsPanel, snapshot.value)});
  app.mount(root);
  return {
    update(state: ConnectionsState, channels: ConnectionChannel[], icon: IconRenderer) {
      snapshot.value = {state, channels, icon};
    },
    destroy() {app.unmount();},
  };
}
