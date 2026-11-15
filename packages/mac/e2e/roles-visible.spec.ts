import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { SocketClient } from '../../../src/ipc/socket-client.js';
import type { AgentRef } from '../../../src/protocol.js';
import { expect, test, type Locator, type Page } from './fixtures.js';
import { openWork } from './helpers.js';

/**
 * Who did each part of a milestone: a small plan in landing set up as the user's
 * screenshot (architecture Opus, coding DeepSeek, audit GLM, hard fixes Sonnet) runs on the demo's
 * Claudes; its milestone's details say who did what, and its task cards the model of the worktree
 * doing them. Then the same in Chinese, nothing left in English. Screenshots go to the scratch folder.
 */

const SHOTS = process.env.E2E_SHOTS ?? path.join(import.meta.dirname, '../../../.beluga/scratch');
const main = (page: Page) => page.locator('main');

const OPUS: AgentRef = { runtime: 'claude', label: 'Claude', model: 'opus' };
const DEEPSEEK: AgentRef = { runtime: 'local', label: 'Local model', model: 'deepseek/deepseek-flash[1m]' };
const GLM: AgentRef = { runtime: 'local', label: 'Local model', model: 'bigmodel/glm-5.3[1m]' };
const SONNET: AgentRef = { runtime: 'claude', label: 'Claude', model: 'sonnet' };

type Plan = { id: string; status: string; draft?: { title: string; milestones: Array<{ id: string; title: string }> }; body?: { title: string; milestones: Array<{ id: string; title: string }> }; runs: Record<string, { architect?: string; checker?: string; agent?: { worktree: string } }> };

async function until<T>(read: () => T | undefined, ms = 60_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = read();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function openPlan(page: Page, title: string): Promise<void> {
  await page.goto('/');
  await openWork(page, 'Plans');
  await page.getByRole('button', { name: /^Project: / }).click();
  await page.getByRole('menuitem', { name: /landing/ }).click();
  await main(page).getByRole('button', { name: new RegExp(`^${title},`) }).click();
  await expect(main(page).locator('[data-ready="true"]')).toBeVisible({ timeout: 20_000 });
}

const line = (box: Locator, role: string) => box.locator(`[data-role="${role}"]`);

test('the user’s roles on a small plan: each part shows the model that did it, the task card its worktree’s', async ({ page, demo }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const client = await SocketClient.connect({ url: demo.endpoint.url, token: demo.endpoint.token, kind: 'test', version: 'e2e', timeoutMs: 10_000 });
  const plans = (): Plan[] => (client.store.getState() as unknown as { plans: { plans: Plan[] } }).plans.plans;
  let plan: Plan;
  let title: string;
  try {
    const landing = (client.store.getState() as unknown as { projects: Array<{ id: string; name: string }> }).projects.find((p) => p.name === 'landing')!;
    const made = (await client.api.plans.create({ projectId: landing.id, goal: 'Lint the landing page', autonomy: 'autopilot', agent: DEEPSEEK, archAgent: OPUS, checkAgent: GLM, fixAgent: SONNET })) as { id: string };
    // The demo's Claude writes it; approved, its architect (Opus) designs, then its worktree (DeepSeek) works.
    const drafted = await until(() => plans().find((p) => p.id === made.id && p.draft?.milestones.length));
    title = drafted.draft!.title;
    await client.api.plans.approve(made.id);
    const first = drafted.draft!.milestones[0]!.id;
    plan = await until(() => plans().find((p) => p.id === made.id && p.runs[first]?.architect && p.runs[first]?.agent), 120_000);
  } finally {
    client.close();
  }
  const m = plan.body!.milestones[0]!;

  await openPlan(page, title);
  await main(page).getByLabel(new RegExp(`^Criteria of ${m.title}`)).click();
  const who = main(page).getByRole('region', { name: 'Who did it' });
  await expect(who).toBeVisible();
  await expect(line(who, 'arch')).toContainText('Opus');
  await expect(line(who, 'arch')).toHaveAttribute('data-state', 'on');
  await expect(line(who, 'work')).toContainText(/deepseek flash/i);
  await expect(line(who, 'work')).toHaveAttribute('data-state', 'on');
  await expect(line(who, 'check')).toContainText(/glm 5\.3/i);
  await expect(line(who, 'fix')).toContainText('Sonnet');
  // The demo's Claude can stop on the local model: stopping twice, its task goes to the fix agent
  // (Sonnet; the failure ladder isn't in use here), listed under Hard fixes. Nothing handed over: as set, nothing marked.
  const handed = await line(who, 'fix').getByRole('list', { name: 'Handoffs' }).getByRole('listitem').allInnerTexts();
  console.log(`[roles] handoffs: ${JSON.stringify(handed)}`);
  if (!handed.length) await expect(who.locator('[data-why]')).toHaveCount(0);
  // Its task cards: the model of the worktree doing them now.
  const chips = main(page).locator('[data-ran="yes"]');
  await expect(chips.first()).toContainText(handed.length ? /Sonnet|Haiku/ : /deepseek flash/i);
  await who.screenshot({ path: path.join(SHOTS, 'roles-visible-section-en.png') });
  // For the audit: what the daemon recorded for each part, next to what the page says.
  const after = await SocketClient.connect({ url: demo.endpoint.url, token: demo.endpoint.token, kind: 'test', version: 'e2e', timeoutMs: 10_000 });
  try {
    const st = after.store.getState() as unknown as { plans: { plans: Array<Plan & { activity: Array<{ kind: string; text: string }> }> }; projects: Array<{ workspaces: Array<{ id: string; name: string; agent?: AgentRef; model?: string }> }> };
    const now = st.plans.plans.find((p) => p.id === plan.id)!;
    const run = now.runs[m.id]!;
    const wsOf = (id?: string) => st.projects.flatMap((p) => p.workspaces).find((w) => w.id === id);
    const recorded = { architect: wsOf(run.architect), worktree: wsOf(run.agent?.worktree), startedOn: run.agent, checker: wsOf(run.checker), handoffs: now.activity.filter((e) => e.text.startsWith('handed ')).map((e) => e.text) };
    const shown = Object.fromEntries(await Promise.all(['arch', 'work', 'check', 'fix'].map(async (k) => [k, await line(who, k).innerText()])));
    writeFileSync(path.join(SHOTS, 'roles-audit.json'), JSON.stringify({ settings: { archAgent: OPUS, agent: DEEPSEEK, checkAgent: GLM, fixAgent: SONNET }, recorded, shown, taskCards: await chips.allInnerTexts() }, null, 2));
  } finally {
    after.close();
  }
  await page.screenshot({ path: path.join(SHOTS, 'roles-visible-en.png') });

  // In Chinese: the same, with no English words left in the section (model names aside).
  await page.evaluate(() => localStorage.setItem('beluga.language', 'zh-CN'));
  await page.reload();
  await page.getByRole('navigation', { name: '侧边栏' }).getByRole('button', { name: '工作', exact: true }).click();
  await page.getByRole('tablist', { name: '工作' }).getByRole('tab', { name: '计划' }).click();
  await main(page).getByRole('button', { name: new RegExp(`^${title}`) }).first().click();
  await main(page).getByLabel(new RegExp(`^${m.title} 的标准`)).click();
  const zh = main(page).getByRole('region', { name: '谁做的' });
  await expect(zh).toBeVisible();
  for (const word of ['架构', '编码', '审计', '疑难修复']) await expect(zh).toContainText(word);
  const left = ((await zh.innerText()).replace(/Claude|Opus|Sonnet|Haiku|Deepseek flash|Glm 5\.3|\d+(\.\d+)?/gi, '').match(/[A-Za-z]{2,}/g) ?? []);
  expect(left).toEqual([]);
  await zh.screenshot({ path: path.join(SHOTS, 'roles-visible-section-zh.png') });
  await page.screenshot({ path: path.join(SHOTS, 'roles-visible-zh.png') });
});
