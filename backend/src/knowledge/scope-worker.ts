import { registerExecutionHandler } from '../execution-jobs/handlers.js';
import { generateScope } from './scopes.js';
import { generateKnowledgeSkill,runKnowledgeTest } from './skill-generation.js';
registerExecutionHandler('knowledge.scope',generateScope);
registerExecutionHandler('knowledge.skill.generate',generateKnowledgeSkill);
registerExecutionHandler('knowledge.skill.test',runKnowledgeTest);
