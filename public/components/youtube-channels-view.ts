import {createApp} from 'vue';
import YoutubeChannels from './YoutubeChannels.vue';

export function mountYoutubeChannels(root: Element, props: InstanceType<typeof YoutubeChannels>['$props']) {
  const app = createApp(YoutubeChannels, {...props});
  app.mount(root);
  return {destroy() {app.unmount();}};
}
