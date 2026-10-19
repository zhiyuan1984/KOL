import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { taskDefinitions } from '../src/tasks/registry.js';
import { publishedBusinessContext } from '../src/ontology/runtime-dependencies.js';

describe('shipped creator library query dependencies', () => {
  it('can read through its declared capability without a local ontology release', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creator-query-dependencies-'));
    try {
      const folder = path.join(root, 'creator_library_query');
      fs.mkdirSync(folder);
      fs.copyFileSync(fileURLToPath(new URL('../skills/creator_library_query/SKILL.md', import.meta.url)), path.join(folder, 'SKILL.md'));
      const [definition] = await taskDefinitions(root);
      const query = vi.fn();
      expect(await publishedBusinessContext('authorized-person', definition.ontology || [], { query } as never)).toBeNull();
      expect(query).not.toHaveBeenCalled();
      // Removing this extra prerequisite must retain the reviewed read path.
      expect(definition.capabilities).toContainEqual({ id: 'creator.query', version: 1 });
      expect(definition.mcp).toEqual(['starrykol.pageKolProfiles', 'starrykol.getKolProfileSidebarMetrics']);
      expect(definition.permissions).toEqual(['creator:read']);
      expect(definition.side_effects).toBe('none');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
