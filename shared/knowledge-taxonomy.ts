import type { OntologyTaxonomy } from './ontology.js';

/**
 * Read-only business taxonomy for knowledge-base planning. Nodes are the
 * canonical enterprise ontology tree; bindings only connect an existing base
 * to one canonical theme and never expose knowledge content.
 */
export type KnowledgeBusinessTaxonomy = {
  sourceVersion: string;
  nodes: OntologyTaxonomy['nodes'];
  bindings: Array<{ baseId: string; themeId: string }>;
};
