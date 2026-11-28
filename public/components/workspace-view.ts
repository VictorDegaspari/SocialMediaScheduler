import {h, reactive, render} from 'vue';
import BrowserPage from './BrowserPage.vue';
import CutCaptionRows from './CutCaptionRows.vue';
import CutCaptionPreview from './CutCaptionPreview.vue';
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
import LinkPublicationDialog from './LinkPublicationDialog.vue';
import LiveCutRangeDialog from './LiveCutRangeDialog.vue';
import OverviewPage from './OverviewPage.vue';
import WatchFormFields from './WatchFormFields.vue';
import WorkspaceNotice from './WorkspaceNotice.vue';
import WorkspaceShell from './WorkspaceShell.vue';
import type {WorkspaceShellState} from './workspace-shell.js';
export {workspacePages} from './workspace-shell.js';

const views = {
  browser: BrowserPage,
  captionRows: CutCaptionRows,
  captionPreview: CutCaptionPreview,
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
  linkPublication: LinkPublicationDialog,
  notice: WorkspaceNotice,
  overview: OverviewPage,
  watchForm: WatchFormFields,
};

export function drawWorkspace(root: Element, view: keyof typeof views, props: Record<string, unknown> = {}) {
  // The controllers read native form and media elements immediately after mounting a view.
  render(h(views[view], props), root);
}

export function clearWorkspace(root: Element) {
  render(null, root);
}

export function mountWorkspaceModal(view: 'discardConfirmation' | 'cutSourceRange' | 'linkPublication', props: Record<string, unknown>) {
  const host = document.body.appendChild(document.createElement('div'));
  drawWorkspace(host, view, props);
  return {
    dialog: host.querySelector('dialog')!,
    destroy() { clearWorkspace(host); host.remove(); },
  };
}

export function mountWorkspaceShell(root: Element) {
  const model = reactive<WorkspaceShellState>({
    page: 'overview', connectionLabel: 'Conectando', offline: false, folderCount: 0, actionCount: 0,
    watchEditing: false, toastMessage: '', toastError: false, toastVisible: false,
  });
  render(h(WorkspaceShell, {model}), root);
  return model;
}
