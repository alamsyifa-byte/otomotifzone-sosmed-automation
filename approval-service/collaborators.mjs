import fs from 'node:fs';

export const normalizeName = (value) => String(value ?? '').normalize('NFKC').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLocaleLowerCase('id-ID');
export function normalizeUsername(value) {
  const name = String(value ?? '').trim().replace(/^@/, '').toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(name) ? name : null;
}

export function resolveCollaborators(sourceAuthor, config) {
  const defaults = (config.default_collaborators || []).map(normalizeUsername);
  if (defaults.length !== 2 || defaults.some(x => !x) || defaults[0] === defaults[1]) {
    throw new Error('Konfigurasi dua collaborator default belum lengkap atau duplikat.');
  }
  const max = Math.min(3, Number(config.maximum_collaborators) || 3);
  const found = (config.authors || []).find(entry =>
    [entry.author_name, ...(entry.author_aliases || [])].some(name => normalizeName(name) === normalizeName(sourceAuthor)));
  const authorUsername = found?.collab_enabled ? normalizeUsername(found.instagram_username) : null;
  const requested = [...new Set([...defaults, ...(authorUsername ? [authorUsername] : [])])].slice(0, max);
  return {
    source_author: String(sourceAuthor ?? '').trim().replace(/\s+/g, ' ').slice(0, 120),
    matched_author: found?.author_name || null,
    requested_collaborators: requested,
    final_collaborators: [],
    collaboration_status: 'NOT_SENT',
    collaboration_error: null,
  };
}

export const collaboratorConfig = JSON.parse(fs.readFileSync(new URL('./instagram-collaborators.json', import.meta.url), 'utf8'));
