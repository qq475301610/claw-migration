import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const skillPath = new URL('../skills/claw-migration/SKILL.md', import.meta.url);

test('skill instructs preview-first push and pull workflow', async () => {
  const content = await fs.readFile(skillPath, 'utf8');
  assert.match(content, /^---\s*$/m);
  assert.match(content, /name:\s*claw-migration/i);
  assert.match(content, /description:\s*Migrate a single OpenClaw agent/i);
  assert.match(content, /preview push/i);
  assert.match(content, /preview pull/i);
  assert.match(content, /stop and summarize blockers/i);
  assert.match(content, /disable the current agent's bindings/i);
  assert.match(content, /remoteKey/i);
  assert.match(content, /no longer relies on manually calling `openclaw gateway restart`/i);
  assert.match(content, /old session history may not remain directly readable/i);
  assert.match(content, /openclaw-china/i);
});
