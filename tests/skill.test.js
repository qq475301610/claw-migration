import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const skillPath = new URL('../skills/claw-migration/SKILL.md', import.meta.url);

test('skill instructs preview-first push and pull workflow', async () => {
  const content = await fs.readFile(skillPath, 'utf8');
  assert.match(content, /preview push/i);
  assert.match(content, /preview pull/i);
  assert.match(content, /stop and summarize blockers/i);
  assert.match(content, /disable the current agent's bindings/i);
});
