import {createApp, h, shallowRef} from 'vue';
import RequestsPanel from './RequestsPanel.vue';
import type {RequestsSnapshot, RequestView} from './request-model.js';
export {requestViews} from './request-model.js';

export function mountRequestsView(root: Element, initial: Omit<RequestsSnapshot, 'revisions'>) {
  const snapshot = shallowRef<RequestsSnapshot>({...initial, revisions: {request: 0, profile: 0, browser: 0}});
  const app = createApp({setup: () => () => h('div', {id: 'requests-panel'}, [h(RequestsPanel, snapshot.value)])});
  app.mount(root);
  return {
    update(next: Omit<RequestsSnapshot, 'revisions'>, resetForms: string[]) {
      const revisions = {...snapshot.value.revisions};
      if (resetForms.includes('publication-request-form')) revisions.request++;
      if (resetForms.includes('publishing-profile-form')) revisions.profile++;
      if (resetForms.includes('browser-profile-form')) revisions.browser++;
      snapshot.value = {...next, revisions};
    },
    selectView(view: RequestView) {snapshot.value = {...snapshot.value, view};},
    destroy() {app.unmount();},
  };
}
