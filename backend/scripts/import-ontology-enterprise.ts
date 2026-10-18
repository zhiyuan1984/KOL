import { postgresTransaction,closePostgresPool } from '../src/postgres/pool.js';
import { importEnterpriseCatalog } from '../src/ontology/enterprise.js';
import { loadOntologyCatalog } from '../src/ontology/catalog.js';
if(!process.argv.includes('--confirmed-user-source'))throw Error('Explicit confirmed user-source import is required');
try{console.log(JSON.stringify(await postgresTransaction(db=>importEnterpriseCatalog(db,loadOntologyCatalog().objects,'user-authorized:2026-10-18'))));}finally{await closePostgresPool();}
