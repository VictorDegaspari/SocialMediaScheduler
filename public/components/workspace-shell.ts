import type {WorkspaceIconName} from './ConnectionIcon.js';

export const workspaceNavigation = [
  {id: 'creation', label: 'Criação', pages: [
    {id: 'cuts', label: 'Gerador de cortes', icon: 'edit'},
    {id: 'youtube-channels', label: 'Canais', icon: 'youtube'},
  ]},
  {id: 'publishing', label: 'Publicação', pages: [
    {id: 'watches', label: 'Minhas pastas', icon: 'folder'},
    {id: 'requests', label: 'Pedidos e contas', icon: 'clock'},
    {id: 'browser', label: 'TikTok navegador', icon: 'tiktok'},
  ]},
  {id: 'management', label: 'Gestão', pages: [
    {id: 'overview', label: 'Visão geral', icon: 'dashboard'},
    {id: 'history', label: 'Histórico', icon: 'history'},
    {id: 'connections', label: 'Conexões', icon: 'link'},
  ]},
] as const satisfies readonly {
  id: string;
  label: string;
  pages: readonly {id: string; label: string; icon: WorkspaceIconName}[];
}[];

type WorkspacePage = typeof workspaceNavigation[number]['pages'][number];
export const workspacePages = workspaceNavigation.flatMap<WorkspacePage>(({pages}) => pages);

export type WorkspaceShellState = {
  page: WorkspacePage['id'];
  connectionLabel: string;
  offline: boolean;
  folderCount: number;
  actionCount: number;
  watchEditing: boolean;
  deliveryPlatform?: 'youtube' | 'tiktok';
  toastMessage: string;
  toastError: boolean;
  toastVisible: boolean;
};
