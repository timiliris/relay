/**
 * Bloc « Environment » injecté avec le contexte de projet en mode agent : OS, shell, outils
 * présents avec leur version, outils absents, état de Playwright. En anglais (il s'adresse au
 * modèle), une centaine de tokens, pour que l'agent ne sonde pas le poste ni ne réinstalle ce
 * qui est déjà là.
 */
import type { Environment, ToolInfo } from './commands';

export function formatEnvironmentBlock(env: Environment): string {
  const available = env.tools.filter((t) => t.path !== null).map(describeTool);
  const missing = env.tools.filter((t) => t.path === null).map((t) => t.name);

  const pw = env.playwright;
  if (pw.python || pw.node) {
    const via = [pw.python && 'python', pw.node && 'node'].filter(Boolean).join(' + ');
    const browsers = pw.browsers.length
      ? `browsers: ${pw.browsers.join(', ')}`
      : 'no browsers downloaded';
    available.push(`playwright${pw.version ? ` ${pw.version}` : ''} (${via}; ${browsers})`);
  } else {
    missing.push('playwright');
  }

  const lines = [
    `Environment: ${env.os}, ${env.shell} shell.`,
    `Available: ${available.length ? available.join(', ') : 'no known tool detected'}.`,
  ];
  if (missing.length) lines.push(`Missing: ${missing.join(', ')}.`);
  lines.push('Trust this list: do not re-check these tools or reinstall them.');
  return lines.join('\n');
}

const describeTool = (t: ToolInfo): string => (t.version ? `${t.name} ${t.version}` : t.name);

/** `true` quand Playwright est utilisable : paquet présent et au moins un navigateur téléchargé. */
export function playwrightReady(env: Environment | null): boolean {
  return Boolean(
    env && (env.playwright.python || env.playwright.node) && env.playwright.browsers.length,
  );
}
