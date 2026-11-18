import {createApp, h, shallowRef} from 'vue';
import type {CutOverlay} from '../../src/cuts-overlays.js';
import CutOverlayPanel from './CutOverlayPanel.vue';

export function mountOverlayView(root: Element, layers: CutOverlay[], selected: string | null, duration: number) {
  // Snapshots keep Vue rendering separate from the controller's mutable media state.
  const snapshot = () => layers.map(layer => ({...layer}));
  const state = shallowRef({layers: snapshot(), selected, duration, message: ''});
  const app = createApp({setup: () => () => h(CutOverlayPanel, state.value)});
  app.mount(root);
  return {
    update(nextLayers: CutOverlay[], nextSelected: string | null, nextDuration: number) {
      layers = nextLayers;
      state.value = {...state.value, layers: snapshot(), selected: nextSelected, duration: nextDuration};
    },
    feedback(message: string) {state.value = {...state.value, message};},
    destroy() {app.unmount();},
  };
}
