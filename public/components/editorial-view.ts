import {createApp, h, ref} from 'vue';
import CutEditorialFields from './CutEditorialFields.vue';

export {readCommaSeparated, readEditorialOptions} from './editorial-form.js';

type CutEditorialProps = InstanceType<typeof CutEditorialFields>['$props'];

export function mountCutEditorialView(root: Element, props: CutEditorialProps) {
  const platform = ref(props.platform);
  const app = createApp({render: () => h(CutEditorialFields, {...props, platform: platform.value})});
  app.mount(root);
  return {
    setPlatform(value: CutEditorialProps['platform']) {platform.value = value;},
    destroy() {app.unmount();},
  };
}
