export function formatPreview(preview) {
  const lines = [];
  lines.push(`Agent: ${preview.agentId}`);
  lines.push(`Source agent: ${preview.manifest?.source?.agentId}`);
  lines.push(`Created at: ${preview.manifest?.createdAt}`);
  lines.push(`Existing target agent: ${preview.target.hasExistingAgent ? 'yes' : 'no'}`);
  lines.push(`Target workspace: ${preview.target.workspacePath}`);
  if (preview.overwrite.length > 0) {
    lines.push(`Will overwrite: ${preview.overwrite.join(', ')}`);
  }
  if (preview.additions.length > 0) {
    lines.push(`Will add: ${preview.additions.join(', ')}`);
  }
  if (preview.missing.channels.length > 0) {
    lines.push(`Missing channels: ${preview.missing.channels.join(', ')}`);
  }
  if (preview.missing.plugins.length > 0) {
    lines.push(`Missing plugins: ${preview.missing.plugins.join(', ')}`);
  }
  if (preview.missing.skills.length > 0) {
    lines.push(`Missing skills: ${preview.missing.skills.join(', ')}`);
  }
  if (preview.warnings.length > 0) {
    lines.push(`Warnings: ${preview.warnings.join(' | ')}`);
  }
  if (preview.blockers.length > 0) {
    lines.push(`Blockers: ${preview.blockers.join(' | ')}`);
  }
  return lines.join('\n');
}

export function formatVerify(result) {
  const lines = [];
  lines.push(`Valid: ${result.ok ? 'yes' : 'no'}`);
  lines.push(`Agent: ${result.manifest?.source?.agentId ?? 'unknown'}`);
  lines.push(`Created at: ${result.manifest?.createdAt ?? 'unknown'}`);
  lines.push(`Files: ${result.files.length}`);
  if (result.warnings.length > 0) {
    lines.push(`Warnings: ${result.warnings.join(' | ')}`);
  }
  if (result.blockers.length > 0) {
    lines.push(`Blockers: ${result.blockers.join(' | ')}`);
  }
  return lines.join('\n');
}
