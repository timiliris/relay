import { useNavigate } from '@tanstack/react-router';
import { open } from '@tauri-apps/plugin-dialog';
import { FolderOpen, FolderX, GitBranch, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { agentCommands } from '@/lib/agent/commands';
import type { Conversation } from '@/lib/db';
import { errorMessage, isTauri } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import { useAgent } from '@/stores/agent';
import { useConversations } from '@/stores/conversations';
import { useSettings } from '@/stores/settings';
import { toast } from '@/stores/toast';
import { Button } from './ui/button';
import { Dropdown, DropdownItem } from './ui/dropdown';

/** Nom court d'un dossier à partir de son chemin absolu. */
export const workspaceName = (path: string): string =>
  path
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() || path;

/**
 * Dossier de travail du mode agent, dans l'en-tête de conversation. Sans conversation
 * ouverte, choisir un dossier crée une conversation en mode agent et l'ouvre.
 */
export function WorkspacePicker({ conversation }: { conversation: Conversation | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const inTauri = isTauri();
  const update = useConversations((s) => s.update);
  const create = useConversations((s) => s.create);
  const settings = useSettings();
  const info = useAgent((s) => (conversation ? s.workspaces[conversation.id] : undefined));
  const rememberWorkspace = useAgent((s) => s.rememberWorkspace);
  const workspace = conversation?.workspace ?? null;

  const choose = async () => {
    try {
      const picked = await open({
        directory: true,
        multiple: false,
        title: t('chat.agent.workspace'),
      });
      if (typeof picked !== 'string') return;
      const registered = await agentCommands.registerWorkspace(picked);
      if (conversation) {
        await update(conversation.id, { workspace: registered.root, agent: true });
        rememberWorkspace(conversation.id, registered);
      } else {
        const created = await create({
          title: registered.name,
          model: settings.defaultModel,
          systemPrompt: settings.systemPrompt.trim() || null,
          webSearch: settings.webSearch,
          workspace: registered.root,
          agent: true,
        });
        rememberWorkspace(created.id, registered);
        await navigate({ to: '/chat/$conversationId', params: { conversationId: created.id } });
      }
      toast.success(t('chat.agent.workspaceSet', { name: registered.name }));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const clear = async () => {
    if (!conversation) return;
    await update(conversation.id, { workspace: null, agent: false });
  };

  if (!workspace) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
        disabled={!inTauri}
        title={inTauri ? t('chat.agent.chooseWorkspace') : t('common.onlyInApp')}
        onClick={() => void choose()}
      >
        <FolderOpen className="size-4" />
        <span className="hidden text-xs md:inline">{t('chat.agent.workspace')}</span>
      </Button>
    );
  }

  return (
    <Dropdown
      align="end"
      className="w-64 p-1"
      trigger={({ toggle }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={toggle}
          className={cn('gap-1.5', conversation?.agent ? 'text-primary' : 'text-muted-foreground')}
          title={workspace}
          aria-label={t('chat.agent.workspaceSet', { name: workspaceName(workspace) })}
        >
          <FolderOpen className="size-4" />
          <span className="hidden max-w-32 truncate text-xs md:inline">
            {workspaceName(workspace)}
          </span>
          {info?.git && <GitBranch className="size-3 text-chart-3" aria-label="git" />}
        </Button>
      )}
    >
      {(close) => (
        <>
          <p
            className="truncate px-2 py-1.5 font-mono text-[11px] text-muted-foreground"
            title={workspace}
          >
            {workspace}
          </p>
          <DropdownItem
            onClick={() => {
              close();
              void choose();
            }}
          >
            <RefreshCw />
            {t('chat.agent.changeWorkspace')}
          </DropdownItem>
          <DropdownItem
            destructive
            onClick={() => {
              close();
              void clear();
            }}
          >
            <FolderX />
            {t('chat.agent.clearWorkspace')}
          </DropdownItem>
        </>
      )}
    </Dropdown>
  );
}
