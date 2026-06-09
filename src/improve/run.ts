import type { ModelProvider } from '../providers/types.js';
import type { Message } from '../agent/types.js';
import { reflect, serializeTranscript } from './reflect.js';
import { slugify } from './slug.js';
import { createImprovementPr } from './pr.js';

export interface RunImprovementOptions {
  provider: ModelProvider;
  messages: readonly Message[];
  cwd: string;
  baseBranch: string;
  /** Surface a line of status to the user. */
  log: (line: string) => void;
  /** Ask the user to approve opening a PR; returns true to proceed. */
  confirm: (title: string) => Promise<boolean>;
}

/** First `# ` heading in the markdown, used as the PR title and slug seed. */
function extractTitle(markdown: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match && match[1] ? match[1].trim() : 'tiny-code improvement';
}

/**
 * End-to-end improvement flow: reflect on the session, and if there's a
 * proposal, ask the user before opening a markdown-only PR. Never throws — it
 * is safe to call from the REPL's exit path.
 */
export async function runImprovement(opts: RunImprovementOptions): Promise<void> {
  try {
    const transcript = serializeTranscript(opts.messages);
    if (transcript.trim().length === 0) {
      opts.log('No session activity to reflect on.');
      return;
    }

    const proposal = await reflect({ provider: opts.provider, transcript, cwd: opts.cwd });
    if (!proposal) {
      opts.log('No improvements suggested for this session.');
      return;
    }

    const title = extractTitle(proposal);
    const approved = await opts.confirm(title);
    if (!approved) {
      opts.log('Skipped — no PR created.');
      return;
    }

    const result = await createImprovementPr({
      cwd: opts.cwd,
      slug: slugify(title),
      title,
      markdown: proposal,
      baseBranch: opts.baseBranch,
    });

    if (result.ok) {
      opts.log(`Opened improvement PR${result.url ? `: ${result.url}` : '.'}`);
    } else {
      opts.log(`Could not open PR: ${result.reason ?? 'unknown error'}`);
    }
  } catch (err) {
    opts.log(`Improvement step failed: ${(err as Error).message}`);
  }
}
