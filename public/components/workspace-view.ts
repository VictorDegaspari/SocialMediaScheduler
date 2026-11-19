import {h, render} from 'vue';
import BrowserPage from './BrowserPage.vue';
import CutCaptionRows from './CutCaptionRows.vue';
import CutEditorFields from './CutEditorFields.vue';
import CutLibrary from './CutLibrary.vue';
import CutPublishFields from './CutPublishFields.vue';
import CutRemovedRanges from './CutRemovedRanges.vue';
import CutReplayGraph from './CutReplayGraph.vue';
import CutSourcePreparation from './CutSourcePreparation.vue';
import CutsPage from './CutsPage.vue';
import DeliveryReviewFields from './DeliveryReviewFields.vue';
import DiscardConfirmation from './DiscardConfirmation.vue';
import FoldersPage from './FoldersPage.vue';
import HistoryPage from './HistoryPage.vue';
import ImmediateVideoDialog from './ImmediateVideoDialog.vue';
import LiveCutRangeDialog from './LiveCutRangeDialog.vue';
import OverviewPage from './OverviewPage.vue';
import WatchFormFields from './WatchFormFields.vue';
import WorkspaceSelectOptions from './WorkspaceSelectOptions.vue';

const views = {
  browser: BrowserPage,
  captionRows: CutCaptionRows,
  cutEditor: CutEditorFields,
  cutLibrary: CutLibrary,
  cutPublish: CutPublishFields,
  cutRemovals: CutRemovedRanges,
  cutReplay: CutReplayGraph,
  cutSource: CutSourcePreparation,
  cutSourceRange: LiveCutRangeDialog,
  cuts: CutsPage,
  deliveryReview: DeliveryReviewFields,
  discardConfirmation: DiscardConfirmation,
  folders: FoldersPage,
  history: HistoryPage,
  immediateVideo: ImmediateVideoDialog,
  overview: OverviewPage,
  selectOptions: WorkspaceSelectOptions,
  watchForm: WatchFormFields,
};

export function drawWorkspace(root: Element, view: keyof typeof views, props: Record<string, unknown> = {}) {
  // The controllers read native form and media elements immediately after mounting a view.
  render(h(views[view], props), root);
}

export function clearWorkspace(root: Element) {
  render(null, root);
}
